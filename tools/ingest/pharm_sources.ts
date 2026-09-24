/**
 * SHARED CITATION TABLE for the receptor registries.
 *
 * Extracted into its own module to break a cycle: part two of the registry needs
 * these labels at module-evaluation time, and part one needs part two's entries at
 * the same moment. With the table in either registry, whichever loaded second saw
 * `undefined`. A leaf module that neither imports solves it properly rather than by
 * reordering imports and hoping.
 */

export const SOURCES = {
  GG14: {
    label: "Brunton LL, Knollmann BC (eds). Goodman & Gilman's The Pharmacological Basis of Therapeutics, 14th ed. McGraw Hill, 2023.",
    url: 'https://www.accesspharmacy.mhmedical.com/book.aspx?bookid=3191',
  },
  RANG10: {
    label: "Ritter JM, Flower R, Henderson G, et al. Rang & Dale's Pharmacology, 10th ed. Elsevier, 2023.",
    url: 'https://www.elsevier.com/books/rang-and-dales-pharmacology/ritter/978-0-323-87395-5',
  },
  CONCISE2023: {
    label: 'Alexander SPH, et al. THE CONCISE GUIDE TO PHARMACOLOGY 2023/24. Br J Pharmacol 180(S2), 2023.',
    url: 'https://doi.org/10.1111/bph.16177',
  },
  GH14: {
    label: 'Hall JE, Hall ME. Guyton and Hall Textbook of Medical Physiology, 14th ed. Elsevier, 2021.',
    url: 'https://www.elsevier.com/books/guyton-and-hall-textbook-of-medical-physiology/hall/978-0-323-59712-8',
  },
} as const;

export type SourceKey = keyof typeof SOURCES;
