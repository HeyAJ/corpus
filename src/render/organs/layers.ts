/**
 * LAYER ORGANS: the pure rules, and the bone look. No three.js import, so a test can read them.
 *
 * WHAT A LAYER ORGAN IS. Most organs belong to the body: they are built at boot, drawn and
 * picked always. A LAYER organ (`OrganDef.layer`, today `'bones'` and `'muscles'`; `'lymph'`
 * will follow) belongs to an optional overlay a visitor switches on. Five skeleton
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

/** The layers an organ can belong to. Extend with `'lymph'` when it arrives. */
export type LayerId = 'bones' | 'muscles';

/** Every layer name the renderer knows, in the order the Layers control lists them. */
export const LAYER_IDS: readonly LayerId[] = ['bones', 'muscles'];

/** Which layers are switched on. */
export type LayerFlags = Record<LayerId, boolean>;

/** All layers off: the default view. */
export function noLayers(): LayerFlags {
  return { bones: false, muscles: false };
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

/*
 * THE MUSCLE LOOK. Like the bone look, every number is a DISPLAY choice and not a measurement of
 * muscle. Muscle is drawn in the same multiply-blend bucket as every organ shell (ADR-002), so it
 * is order-independent against the organs, bones, vessels and nerves by the same argument.
 *
 *   - TINT: a muscle red, deeper and browner than the pink every soft organ is mixed toward, so a
 *     muscle is not read as a blood-filled organ and not as bone. It is the colour the muscle
 *     transmits light as, not the colour of the surface.
 *   - DENSITY: lower than a soft organ's and a little lower than bone's. The muscles are the
 *     OUTERMOST soft layer: the chest wall, the abdominal wall and the back muscles each lie
 *     across the whole front or back of the trunk, so a ray that reaches the heart, lungs, liver
 *     or bowel crosses a muscle sheet first. At the soft-organ density, and at the bone density,
 *     a sheet in front of the viscera turned the trunk into one red mass in which no organ could
 *     be told apart (the same failure the bone-density comment above records for the ribs).
 *     0.5 is the PROVISIONAL value chosen for the stub shells, which are single slabs; it has not
 *     yet been checked against real, many-layered muscle geometry.
 *
 * Muscle content agents: this is the knob to revisit once real muscles replace the stub slabs,
 * exactly as the bone comment says for the skeleton. Retune it by looking at the front and side
 * views of the trunk with Muscles on, not by calculation.
 */
/** The red muscle transmits light as (sRGB hex). A display choice. */
export const MUSCLE_TINT = 0xb5524a;

/** Multiplier on a muscle shell's absorption density. A display choice; see the comment above. */
export const MUSCLE_DENSITY = 0.5;

/**
 * How far a muscle's activity-mode colour may leave its red: 0 keeps muscle red in Activity mode,
 * 1 gives it the ramp colour like any organ. Muscle is the one layer whose parts DO have live
 * engine signals (exertion, shivering, paralysis, rigidity), so it follows the ramp more than
 * bone does, but not fully, so a resting body of muscle is still recognisably muscle. A display
 * choice.
 */
export const MUSCLE_ACTIVITY_COLOUR_MIX = 0.55;

/**
 * The look of each layer, gathered so OrganSet reads one table and the lymph layer adds a row
 * instead of a branch. Bones and muscles today.
 */
export const LAYER_LOOK: Record<LayerId, { tint: number; density: number; activityColourMix: number }> = {
  bones: { tint: BONE_TINT, density: BONE_DENSITY, activityColourMix: BONE_ACTIVITY_COLOUR_MIX },
  muscles: { tint: MUSCLE_TINT, density: MUSCLE_DENSITY, activityColourMix: MUSCLE_ACTIVITY_COLOUR_MIX },
};
