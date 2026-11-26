import { describe, expect, it } from 'vitest';
import { buildShareHash, parseShareHash, maxWeeks, type ShareState } from '../../src/ui/shareLink';

const FULL: ShareState = {
  sex: 'female',
  weeks: 28,
  organ: 'uterus',
  part: 'placenta',
  layers: ['bones', 'muscles', 'vessels', 'nerves', 'hormones', 'activity'],
  cut: { axis: 'front', depth: 0.5 },
};

describe('share link build and parse', () => {
  it('builds the documented format', () => {
    expect(buildShareHash(FULL)).toBe('#v=1&sex=female&weeks=28&organ=uterus&part=placenta&layers=bones,vessels,nerves,hormones,activity&cut=front:0.5');
  });

  it('round-trips a full state', () => {
    expect(parseShareHash(buildShareHash(FULL))).toEqual(FULL);
  });

  it('round-trips a male body with an organ, a part and a cut', () => {
    const s: ShareState = { sex: 'male', organ: 'kidney_l', part: 'renal_medulla', cut: { axis: 'side', depth: 0.25 } };
    expect(parseShareHash(buildShareHash(s))).toEqual(s);
  });

  it('restores the bones layer from layers=bones, and opens a skeleton organ with its layer off', () => {
    expect(parseShareHash('#v=1&layers=bones')).toEqual({ layers: ['bones'] });
    expect(buildShareHash({ layers: ['bones'] })).toBe('#v=1&layers=bones');
    // A skeleton organ is a catalogue organ (it is built on demand), so a link may open it.
    expect(parseShareHash('#v=1&organ=thoracic_cage')).toEqual({ organ: 'thoracic_cage' });
  });

  it('restores the muscles layer from layers=muscles, in layer order, and opens a muscle organ with its layer off', () => {
    expect(parseShareHash('#v=1&layers=muscles')).toEqual({ layers: ['muscles'] });
    expect(buildShareHash({ layers: ['muscles'] })).toBe('#v=1&layers=muscles');
    // Bones come before muscles in the written link whatever order the caller gave them.
    expect(buildShareHash({ layers: ['muscles', 'bones'] })).toBe('#v=1&layers=bones,muscles');
    expect(parseShareHash('#v=1&layers=muscles,bones')).toEqual({ layers: ['bones', 'muscles'] });
    // A muscle organ is a catalogue organ (built on demand), so a link may open it.
    expect(parseShareHash('#v=1&organ=back_muscles')).toEqual({ organ: 'back_muscles' });
  });

  it('leaves weeks out of a male body and an empty layer list out of the hash', () => {
    expect(buildShareHash({ sex: 'male', weeks: 20, layers: [] })).toBe('#v=1&sex=male');
  });

  it('reads the pregnancy ceiling from the data', () => {
    expect(maxWeeks()).toBeGreaterThan(0);
  });
});

/** Each malformed input and the fields that must nevertheless survive from it. */
const CASES: [string, string, ShareState][] = [
  ['no v', '#sex=female&organ=heart', {}],
  ['wrong version', '#v=2&sex=female', {}],
  ['version zero', '#v=0&sex=male', {}],
  ['empty hash', '', {}],
  ['just a hash sign', '#', {}],
  ['unknown organ', '#v=1&sex=male&organ=gizzard', { sex: 'male' }],
  ['uterus on a male body', '#v=1&sex=male&organ=uterus', { sex: 'male' }],
  ['fetus without a pregnancy', '#v=1&sex=female&organ=fetus', { sex: 'female' }],
  ['part of another organ', '#v=1&sex=male&organ=heart&part=renal_cortex', { sex: 'male', organ: 'heart' }],
  ['part without its organ', '#v=1&sex=male&part=renal_cortex', { sex: 'male' }],
  ['weeks 99', '#v=1&sex=female&weeks=99', { sex: 'female' }],
  ['weeks injection', '#v=1&sex=female&weeks=28;alert(1)', { sex: 'female' }],
  ['weeks negative', '#v=1&sex=female&weeks=-3', { sex: 'female' }],
  ['weeks fractional', '#v=1&sex=female&weeks=2.5', { sex: 'female' }],
  ['weeks for a male body', '#v=1&sex=male&weeks=28', { sex: 'male' }],
  ['bad sex', '#v=1&sex=other&organ=heart', { organ: 'heart' }],
  ['cut with a bad axis and depth', '#v=1&organ=heart&cut=sideways:2', { organ: 'heart' }],
  ['cut depth over one', '#v=1&organ=heart&cut=front:1.5', { organ: 'heart' }],
  ['cut depth not a number', '#v=1&organ=heart&cut=front:abc', { organ: 'heart' }],
  ['layers with one bad name (muscles is not a layer yet)', '#v=1&organ=heart&layers=vessels,muscles', { organ: 'heart' }],
  ['empty layers', '#v=1&organ=heart&layers=', { organ: 'heart' }],
  ['a 10 kB value', '#v=1&organ=heart&part=' + 'a'.repeat(10000), {}],
  ['a 65 character value', '#v=1&sex=male&organ=' + 'a'.repeat(65), { sex: 'male' }],
  ['duplicate keys', '#v=1&organ=heart&organ=liver&sex=male', { sex: 'male' }],
  ['unknown keys are ignored', '#v=1&sex=male&drug=morphine&__proto__=x&organ=heart', { sex: 'male', organ: 'heart' }],
  ['percent-encoded payload', '#v=1&organ=%68eart&sex=male', { sex: 'male' }],
  ['script in the organ', '#v=1&sex=male&organ=<script>alert(1)</script>', { sex: 'male' }],
  ['uppercase organ', '#v=1&sex=male&organ=HEART', { sex: 'male' }],
  ['pairs with no equals sign', '#v=1&heart&&&=&sex=male', { sex: 'male' }],
];

describe('malformed share links', () => {
  it('has at least twenty cases', () => {
    expect(CASES.length).toBeGreaterThanOrEqual(20);
  });

  for (const [name, hash, expected] of CASES) {
    it(`${name}: keeps only the valid fields and does not throw`, () => {
      let out: ShareState = {};
      expect(() => {
        out = parseShareHash(hash);
      }).not.toThrow();
      expect(out).toEqual(expected);
    });
  }

  it('uses the current body when the link names no sex', () => {
    const catalogueFor = undefined;
    const out = parseShareHash('#v=1&organ=uterus', catalogueFor, { sex: 'female', pregnant: false });
    expect(out).toEqual({ organ: 'uterus' });
    expect(parseShareHash('#v=1&organ=uterus', catalogueFor, { sex: 'male', pregnant: false })).toEqual({});
  });

  it('accepts the fetus only with a pregnancy in the link', () => {
    expect(parseShareHash('#v=1&sex=female&weeks=30&organ=fetus')).toEqual({ sex: 'female', weeks: 30, organ: 'fetus' });
  });

  it('never throws on non-string input', () => {
    expect(() => parseShareHash(undefined as unknown as string)).not.toThrow();
    expect(() => parseShareHash(null as unknown as string)).not.toThrow();
  });
});

describe('share links and finer structures', () => {
  it('accepts a child part of the open organ and round-trips it', () => {
    const state: ShareState = { sex: 'male', organ: 'heart', part: 'papillary_muscles_lv' };
    expect(buildShareHash(state)).toBe('#v=1&sex=male&organ=heart&part=papillary_muscles_lv');
    expect(parseShareHash(buildShareHash(state))).toEqual(state);
  });

  it('accepts a child of a level-2 and a level-1 part alike', () => {
    expect(parseShareHash('#v=1&sex=male&organ=heart&part=fossa_ovalis')).toEqual({ sex: 'male', organ: 'heart', part: 'fossa_ovalis' });
    expect(parseShareHash('#v=1&sex=male&organ=heart&part=left_ventricle')).toEqual({ sex: 'male', organ: 'heart', part: 'left_ventricle' });
  });

  it('drops a child of another organ and an unknown child', () => {
    expect(parseShareHash('#v=1&sex=male&organ=kidney_l&part=papillary_muscles_lv')).toEqual({ sex: 'male', organ: 'kidney_l' });
    expect(parseShareHash('#v=1&sex=male&organ=heart&part=papillary_muscles_xx')).toEqual({ sex: 'male', organ: 'heart' });
  });
});

