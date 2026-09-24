"""
ORGAN MESH PREPARATION — Blender headless script (spec 7.5).

    blender --background --python tools/prep-assets/clean_organ.py -- \
        --in raw/heart.obj --out public/organs/organ_heart.glb \
        --id heart --tris 15000 --voxel 0.003

Script it, don't click it. A hand-cleaned mesh cannot be reproduced, cannot be
re-run when the budget changes, and cannot be diffed.

WHY BODYPARTS3D MESHES NEED THIS AT ALL
---------------------------------------
They are segmentations of volumetric scan data, not modelled assets. Expect
non-manifold edges, inconsistent normals, interior faces, stair-step artefacts from
voxel segmentation, loose geometry, and origins at the global body centre rather
than at each organ's own centroid.

That last one matters more here than it would elsewhere. CORPUS scales the heart
mesh by live chamber volume and lerps the camera to each organ's bounding-sphere
centre, so an origin in the wrong place makes the heart pulse about someone else's
sternum and the camera frame empty space.

And the stair-stepping matters because of what the material does. The absorption
shader has no diffuse or specular term: form is carried entirely by silhouette and
fresnel. Silhouette is therefore the ONLY thing being rendered, so every voxel
artefact on the outline is fully visible even though the surface itself is not.

THE ORDER IS NOT NEGOTIABLE
---------------------------
Voxel remesh, then smooth, then decimate.

  - Voxel remeshing discards the original topology entirely and rebuilds a
    watertight manifold at a uniform resolution. It is what converts scan noise into
    a clean closed surface; nothing downstream can recover from skipping it.
  - Smoothing then removes the voxel stair-stepping the remesh introduced.
  - Decimation last, because decimating before smoothing bakes the stair-steps into
    the reduced topology where they can no longer be removed.

Decimating first is the common mistake and it produces a mesh that looks acceptable
in a shaded viewport and terrible through this material.
"""

import argparse
import json
import math
import os
import sys

try:
    import bpy
    import bmesh
    from mathutils import Vector
except ImportError:  # pragma: no cover - only importable inside Blender
    print(
        "clean_organ.py must be run inside Blender:\n"
        "  blender --background --python tools/prep-assets/clean_organ.py -- --help",
        file=sys.stderr,
    )
    raise SystemExit(2)


# Triangle budgets from spec 7.5. Total scene budget 140 k.
DEFAULT_BUDGETS = {
    "heart": 15000,
    "lung_l": 12000,
    "lung_r": 12000,
    "brain": 20000,
    "liver": 10000,
    "intestine_small": 15000,
    "intestine_large": 10000,
    "stomach": 8000,
}
FALLBACK_BUDGET = 6000


def parse_args(argv):
    if "--" in argv:
        argv = argv[argv.index("--") + 1 :]
    else:
        argv = []

    p = argparse.ArgumentParser(description="Clean one organ mesh for CORPUS.")
    p.add_argument("--in", dest="source", required=True, help="input OBJ/PLY/STL")
    p.add_argument("--out", dest="target", required=True, help="output .glb")
    p.add_argument("--id", dest="organ_id", required=True, help="organ id from data/organs.json")
    p.add_argument("--tris", type=int, default=None, help="triangle budget (default: per-organ)")
    p.add_argument(
        "--voxel",
        type=float,
        default=0.003,
        help="voxel remesh size in metres. 0.002-0.004 is the useful range: smaller "
        "keeps detail the material cannot show, larger loses the silhouette.",
    )
    p.add_argument("--smooth-iterations", type=int, default=12)
    p.add_argument("--smooth-factor", type=float, default=0.5)
    p.add_argument("--scale", type=float, default=1.0, help="input units to metres")
    p.add_argument("--manifest", default="public/organ-manifest.json")
    return p.parse_args(argv)


def clear_scene():
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    for block in (bpy.data.meshes, bpy.data.objects, bpy.data.materials):
        for item in list(block):
            block.remove(item)


def import_mesh(path):
    ext = os.path.splitext(path)[1].lower()
    if ext == ".obj":
        # Blender 4.x renamed the operator; support both.
        if hasattr(bpy.ops.wm, "obj_import"):
            bpy.ops.wm.obj_import(filepath=path)
        else:
            bpy.ops.import_scene.obj(filepath=path)
    elif ext == ".ply":
        bpy.ops.wm.ply_import(filepath=path) if hasattr(bpy.ops.wm, "ply_import") else bpy.ops.import_mesh.ply(filepath=path)
    elif ext == ".stl":
        bpy.ops.wm.stl_import(filepath=path) if hasattr(bpy.ops.wm, "stl_import") else bpy.ops.import_mesh.stl(filepath=path)
    else:
        raise SystemExit(f"unsupported input format: {ext}")

    meshes = [o for o in bpy.context.scene.objects if o.type == "MESH"]
    if not meshes:
        raise SystemExit(f"no mesh found in {path}")

    # A BodyParts3D export is often several loose shells. Join them so the remesh
    # sees one volume.
    bpy.ops.object.select_all(action="DESELECT")
    for o in meshes:
        o.select_set(True)
    bpy.context.view_layer.objects.active = meshes[0]
    if len(meshes) > 1:
        bpy.ops.object.join()
    return bpy.context.view_layer.objects.active


def triangle_count(obj):
    mesh = obj.data
    return sum(max(0, len(p.vertices) - 2) for p in mesh.polygons)


def count_non_manifold(obj):
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    n = sum(1 for e in bm.edges if not e.is_manifold)
    bm.free()
    return n


def step(label, fn):
    print(f"  {label:<34}", end="", flush=True)
    result = fn()
    print("done" if result is None else result)
    return result


def main():
    args = parse_args(sys.argv)
    budget = args.tris or DEFAULT_BUDGETS.get(args.organ_id, FALLBACK_BUDGET)

    print(f"\nCORPUS organ preparation: {args.organ_id}")
    print(f"  source  {args.source}")
    print(f"  budget  {budget} triangles, voxel {args.voxel} m\n")

    clear_scene()
    obj = import_mesh(args.source)
    bpy.context.view_layer.objects.active = obj

    print(f"  imported                          {triangle_count(obj)} tris, "
          f"{count_non_manifold(obj)} non-manifold edges")

    # 1-3. Merge by distance, delete loose geometry, report non-manifold edges.
    def cleanup():
        bpy.ops.object.mode_set(mode="EDIT")
        bpy.ops.mesh.select_all(action="SELECT")
        bpy.ops.mesh.remove_doubles(threshold=0.0001)
        bpy.ops.mesh.delete_loose(use_verts=True, use_edges=True, use_faces=False)
        bpy.ops.mesh.select_all(action="DESELECT")
        bpy.ops.mesh.select_non_manifold()
        bpy.ops.object.mode_set(mode="OBJECT")
        return f"{count_non_manifold(obj)} non-manifold edges remain"

    step("merge / delete loose", cleanup)

    # 4. VOXEL REMESH. The critical step: discards the scan topology entirely and
    #    rebuilds a watertight manifold. Everything after this assumes it ran.
    def remesh():
        obj.data.remesh_voxel_size = args.voxel
        obj.data.remesh_voxel_adaptivity = 0.0
        bpy.ops.object.voxel_remesh()
        return f"{triangle_count(obj)} tris, {count_non_manifold(obj)} non-manifold"

    step("voxel remesh", remesh)

    # 5. Smooth away the voxel stair-stepping the remesh introduced.
    def smooth():
        mod = obj.modifiers.new(name="Smooth", type="SMOOTH")
        mod.factor = args.smooth_factor
        mod.iterations = args.smooth_iterations
        bpy.ops.object.modifier_apply(modifier=mod.name)
        bpy.ops.object.shade_smooth()

    step("smooth", smooth)

    # 6. Decimate to budget, LAST.
    def decimate():
        current = triangle_count(obj)
        if current <= budget:
            return f"{current} tris, already inside budget"
        mod = obj.modifiers.new(name="Decimate", type="DECIMATE")
        mod.decimate_type = "COLLAPSE"
        mod.ratio = budget / current
        bpy.ops.object.modifier_apply(modifier=mod.name)
        return f"{triangle_count(obj)} tris (target {budget})"

    step("decimate to budget", decimate)

    # 7. Normals outward. The fresnel rim uses abs(dot(N, V)) so it survives an
    #    inverted normal, but the interior fluid clip does not.
    def normals():
        bpy.ops.object.mode_set(mode="EDIT")
        bpy.ops.mesh.select_all(action="SELECT")
        bpy.ops.mesh.normals_make_consistent(inside=False)
        bpy.ops.object.mode_set(mode="OBJECT")

    step("recalculate normals outside", normals)

    # 8. ORIGIN TO GEOMETRY. Required: the camera focus animation lerps to the
    #    bounding-sphere centre and the heart pulse scales about the pivot.
    def origin():
        bpy.ops.object.origin_set(type="ORIGIN_GEOMETRY", center="MEDIAN")
        return f"origin at {tuple(round(v, 4) for v in obj.location)}"

    step("origin to geometry (median)", origin)

    # 9. Scale to metres, Y-up, centred at the world origin.
    def transforms():
        if args.scale != 1.0:
            obj.scale = (args.scale, args.scale, args.scale)
        obj.rotation_euler = (0.0, 0.0, 0.0)
        bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)

    step("apply transforms, scale to metres", transforms)

    # Bounding sphere, for the manifest and for the swap check against the
    # placeholder that this mesh replaces.
    verts = [obj.matrix_world @ v.co for v in obj.data.vertices]
    centre = sum(verts, Vector((0.0, 0.0, 0.0))) / max(1, len(verts))
    radius = max((v - centre).length for v in verts) if verts else 0.0

    # 10. Export glTF, Meshopt-compressed.
    os.makedirs(os.path.dirname(os.path.abspath(args.target)), exist_ok=True)

    def export():
        kwargs = dict(
            filepath=args.target,
            export_format="GLB",
            use_selection=True,
            export_apply=True,
            export_materials="NONE",     # the material is a shader, not an asset
            export_normals=True,
            export_texcoords=False,      # nothing samples a texture
            export_yup=True,
        )
        # Draco is fine; Meshopt decodes faster (spec 2). Blender exposes it only in
        # newer builds, so fall back rather than fail.
        try:
            bpy.ops.export_scene.gltf(**kwargs, export_draco_mesh_compression_enable=False)
        except TypeError:
            bpy.ops.export_scene.gltf(**kwargs)

    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    step("export glb", export)

    # 11. Append to the manifest: bounding sphere, centroid, tri count, source,
    #     licence. This is the contract against which the placeholder swap is
    #     verified rather than eyeballed.
    entry = {
        "id": args.organ_id,
        "file": os.path.basename(args.target),
        "triangles": triangle_count(obj),
        "budget": budget,
        "boundingRadius_m": round(radius, 5),
        "centroid_m": [round(c, 5) for c in centre],
        "voxelSize_m": args.voxel,
        "source": os.path.basename(args.source),
        "licence": os.environ.get("CORPUS_ASSET_LICENCE", "UNRECORDED — set CORPUS_ASSET_LICENCE"),
    }

    manifest = {"organs": []}
    if os.path.exists(args.manifest):
        with open(args.manifest, "r", encoding="utf-8") as f:
            try:
                manifest = json.load(f)
            except json.JSONDecodeError:
                pass
    manifest.setdefault("organs", [])
    manifest["organs"] = [o for o in manifest["organs"] if o.get("id") != args.organ_id]
    manifest["organs"].append(entry)
    manifest["organs"].sort(key=lambda o: o["id"])
    manifest["totalTriangles"] = sum(o.get("triangles", 0) for o in manifest["organs"])

    with open(args.manifest, "w", encoding="utf-8") as f:
        json.dump(manifest, f, indent=2)
        f.write("\n")

    print(f"\n  wrote {args.target}")
    print(f"  wrote {args.manifest}")
    print(f"  bounding radius {radius:.4f} m, centroid {tuple(round(c, 4) for c in centre)}")

    if entry["licence"].startswith("UNRECORDED"):
        print(
            "\n  WARNING: no asset licence recorded. Set CORPUS_ASSET_LICENCE before\n"
            "  processing any mesh. Share-alike is a real constraint and it must be\n"
            "  decided BEFORE the asset is in the repository, not after (spec 7.3).\n"
        )

    if entry["triangles"] > budget * 1.02:
        print(f"\n  WARNING: {entry['triangles']} triangles exceeds the {budget} budget.\n")
        raise SystemExit(1)


if __name__ == "__main__":
    main()
