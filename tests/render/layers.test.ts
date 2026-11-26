import { describe, expect, it } from 'vitest';
import {
  BONE_DENSITY,
  BONE_TINT,
  LAYER_IDS,
  LAYER_LOOK,
  MUSCLE_DENSITY,
  MUSCLE_TINT,
  layerBuildNeeded,
  layerOrganVisible,
  noLayers,
} from '../../src/render/organs/layers';

/**
 * The pure half of the layer-organ gate: an organ of a layer is drawn while the layer is on OR it
 * is selected, and is built only on first need. OrganSet calls these two functions and nothing
 * else decides it, so pinning them pins the behaviour.
 */
describe('layer organ gate', () => {
  it('an organ with no layer is always visible and never built by the layer rule', () => {
    expect(layerOrganVisible(undefined, noLayers(), false)).toBe(true);
    expect(layerBuildNeeded(undefined, noLayers(), true, false, false)).toBe(false);
  });

  it('is visible = layer on OR selected', () => {
    const off = noLayers();
    const on = { ...noLayers(), bones: true };
    expect(layerOrganVisible('bones', off, false)).toBe(false);
    expect(layerOrganVisible('bones', off, true)).toBe(true);
    expect(layerOrganVisible('bones', on, false)).toBe(true);
    expect(layerOrganVisible('bones', on, true)).toBe(true);
  });

  it('builds nothing at boot: layer off and nothing selected requests no build', () => {
    expect(layerBuildNeeded('bones', noLayers(), false, false, false)).toBe(false);
  });

  it('builds on first need: layer switched on, or the organ selected', () => {
    expect(layerBuildNeeded('bones', { ...noLayers(), bones: true }, false, false, false)).toBe(true);
    expect(layerBuildNeeded('bones', noLayers(), true, false, false)).toBe(true);
  });

  it('does not build twice: already built, or a build in flight', () => {
    const on = { ...noLayers(), bones: true };
    expect(layerBuildNeeded('bones', on, false, true, false)).toBe(false);
    expect(layerBuildNeeded('bones', on, false, false, true)).toBe(false);
  });

  it('a cached organ whose layer goes off is simply not visible (no rebuild asked)', () => {
    expect(layerOrganVisible('bones', noLayers(), false)).toBe(false);
    expect(layerBuildNeeded('bones', noLayers(), false, true, false)).toBe(false);
  });
});

describe('bone look', () => {
  it('has a row for every layer, with a density that keeps organs legible through it', () => {
    for (const id of LAYER_IDS) expect(LAYER_LOOK[id]).toBeDefined();
    expect(BONE_DENSITY).toBeGreaterThan(0);
    expect(BONE_DENSITY).toBeLessThan(1);
    expect(LAYER_LOOK.bones.tint).toBe(BONE_TINT);
  });

  it('is ivory: red and green transmit more than blue', () => {
    const r = (BONE_TINT >> 16) & 255;
    const g = (BONE_TINT >> 8) & 255;
    const b = BONE_TINT & 255;
    expect(r).toBeGreaterThan(b);
    expect(g).toBeGreaterThan(b);
  });
});

describe('muscle look', () => {
  it('is a layer of its own, gated exactly like the bones', () => {
    expect(LAYER_IDS).toContain('muscles');
    expect(noLayers().muscles).toBe(false);
    const on = { ...noLayers(), muscles: true };
    expect(layerOrganVisible('muscles', noLayers(), false)).toBe(false);
    expect(layerOrganVisible('muscles', noLayers(), true)).toBe(true);
    expect(layerOrganVisible('muscles', on, false)).toBe(true);
    // Switching muscles on must not draw the skeleton, and the reverse.
    expect(layerOrganVisible('bones', on, false)).toBe(false);
    expect(layerBuildNeeded('muscles', on, false, false, false)).toBe(true);
    expect(layerBuildNeeded('muscles', on, false, true, false)).toBe(false);
  });

  it('is red, and no denser than bone, so organs stay legible through the trunk wall', () => {
    expect(LAYER_LOOK.muscles.tint).toBe(MUSCLE_TINT);
    expect(MUSCLE_DENSITY).toBeGreaterThan(0);
    expect(MUSCLE_DENSITY).toBeLessThanOrEqual(BONE_DENSITY);
    const r = (MUSCLE_TINT >> 16) & 255;
    const g = (MUSCLE_TINT >> 8) & 255;
    const b = MUSCLE_TINT & 255;
    expect(r).toBeGreaterThan(g);
    expect(r).toBeGreaterThan(b);
  });
});
