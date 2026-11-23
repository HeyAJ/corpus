/**
 * LAYER ORGANS: the pure rules, and the bone look. No three.js import, so a test can read them.
 *
 * WHAT A LAYER ORGAN IS. Most organs belong to the body: they are built at boot, drawn and
 * picked always. A LAYER organ (`OrganDef.layer`, today only `'bones'`; `'muscles'` and
 * `'lymph'` will follow) belongs to an optional overlay a visitor switches on. Five skeleton
 * organs carry several hundred thousand triangles between them once their anatomy is real, and a
 * visitor who never opens the skeleton must not pay for it, so such an organ is
 *
 *   - NOT BUILT at boot. It is built, in the geometry worker, the first time it is needed (its
 *     layer switched on, or it is selected by search, the Structures list or a share link), and
 *     then cached for the life of the page.
 *   - DRAWN AND PICKED only while its layer is on OR it is selected. Deselecting it hides it
 *     again; the layer flag is never changed by a selection (opening the rib cage from a search
 *     does not turn Bones on, and closing it does not turn Bones off).
 *   - kept OUT of the glass body outline's fit (`OrganHandle.wanted` stays false for it), because
 *     the outline is fitted to the organs the body always has and a skeleton would change it.
 *
 * The rule is two small functions so it is one fact in one place; OrganSet calls them and
 * tests/render/layers.test.ts pins them.
 */

/** The layers an organ can belong to. Extend with `'muscles'` and `'lymph'` as they arrive. */
export type LayerId = 'bones';

/** Every layer name the renderer knows, in the order the Layers control lists them. */
export const LAYER_IDS: readonly LayerId[] = ['bones'];

/** Which layers are switched on. */
export type LayerFlags = Record<LayerId, boolean>;

/** All layers off: the default view. */
export function noLayers(): LayerFlags {
  return { bones: false };
}

/**
 * Is this organ drawn (and pickable) right now? An organ with no layer is always drawn (this
 * function says nothing about whether the BODY has it: sex and pregnancy are OrganSet's own
 * rule). A layer organ is drawn while its layer is on or while it is the selected organ.
 */
export function layerOrganVisible(layer: LayerId | undefined, flags: LayerFlags, selected: boolean): boolean {
  if (!layer) return true;
  return flags[layer] || selected;
}

/**
 * Should a build be requested now? Only for a layer organ that is wanted (visible by the rule
 * above), has not been built, and is not already being built. An organ with no layer is built
 * by the body rule instead, so this answers false for it.
 */
export function layerBuildNeeded(
  layer: LayerId | undefined,
  flags: LayerFlags,
  selected: boolean,
  built: boolean,
  building: boolean,
): boolean {
  if (!layer) return false;
  return layerOrganVisible(layer, flags, selected) && !built && !building;
}

/* ----------------------------------------------------------------- the bone look */

/*
 * THE BONE LOOK. Every number here is a DISPLAY choice, not a measurement of bone.
 *
 * Bone is drawn in the same multiply-blend absorption bucket as every organ shell (ADR-002), so
 * it is order-independent against the organs, the vessels and the nerves by the same argument:
 * a product of transmittances commutes. It differs from a soft organ in two ways only:
 *
 *   - its TINT is a fixed ivory, not the organ's own colour mixed toward the shared pink: the
 *     pink mix is what gives soft organs their tissue hue, and a pink bone reads as flesh;
 *   - its DENSITY is lower than a soft organ's. A skeleton is a lattice of thin shells that
 *     the eye looks through at a great many organs, and at the soft-organ density the ribs
 *     over the heart and lungs turned the chest into a grey-yellow mass in which no organ could
 *     be told from its neighbour (the same failure the dormant density comment in OrganSet.ts
 *     records for the abdomen). Organs stay legible through bone at this value.
 *
 * Skeleton content agents: these two are the knobs to revisit once real bones (whole vertebrae,
 * ribs with their cartilages) replace the stub shells, since real geometry has many more walls
 * along a ray than a stub has.
 *
 * RETUNED once the real skeleton existed (0.42 to 0.62). With the rib cage, the shoulder and
 * arm bones and the hip and thigh bones drawn properly, the ribs are thin tubes and the limb bones
 * are single shafts, so at 0.42 the whole skeleton read as faint ivory lines behind the organs and
 * the pelvis and arms were barely visible. 0.62 keeps the lungs, heart, liver and bowel legible
 * through the rib cage (checked in the front and side views of the body with Bones on) while
 * the skeleton can be read at a glance.
 */
/** Ivory, the colour bone transmits light as (sRGB hex). A display choice. */
export const BONE_TINT = 0xe9dcb4;

/**
 * Multiplier on a bone shell's absorption density, applied on top of the organ's own dormant
 * density (STATE_STYLE) and its `shellDensity`. A display choice; see the comment above.
 */
export const BONE_DENSITY = 0.62;

/**
 * How far a bone's activity-mode colour may leave the ivory: 0 keeps bone ivory in Activity mode
 * (so the skeleton is never mistaken for a soft organ that is working), 1 gives it the ramp
 * colour like any organ. The engine reports no activity for bone today, so at 0.35 a resting
 * skeleton stays recognisably bone while a future signal would still tint it. A display choice.
 */
export const BONE_ACTIVITY_COLOUR_MIX = 0.35;

/**
 * The look of each layer, gathered so OrganSet reads one table and the muscles and the lymph
 * layers add a row instead of a branch. Bones only today.
 */
export const LAYER_LOOK: Record<LayerId, { tint: number; density: number; activityColourMix: number }> = {
  bones: { tint: BONE_TINT, density: BONE_DENSITY, activityColourMix: BONE_ACTIVITY_COLOUR_MIX },
};
