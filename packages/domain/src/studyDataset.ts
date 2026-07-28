import type { Variable } from "./variable";

/**
 * Where a {@link StudyDataset} came from and how it was produced, kept
 * alongside the dataset itself so every {@link Analysis} built on it can be
 * traced back to its source without leaving ER Explorer.
 *
 * This is the dataset-level counterpart of the reproducibility principle
 * that every analysis must be recoverable from a session file
 * (`docs/REPRODUCIBILITY.md`) - a {@link Session} can only be truly
 * reproducible if the dataset it points to is itself provenance-tracked.
 */
export interface DatasetProvenance {
  /** Free-text description of where the data came from (e.g. `"Pooled Phase II/III, studies A-101/A-102"`). */
  source: string;
  /** Studies contributing to this dataset, when it pools more than one. */
  studyIds?: string[];
  /** Identifier/version of the upstream data transfer or extract this dataset snapshot was built from. */
  extractVersion?: string;
  /** ISO-8601 timestamp of when this dataset snapshot was produced. */
  generatedAt: string;
  /** Content checksum/hash of the underlying data, used to detect drift between a saved Session and the current state of the dataset it references. */
  checksum?: string;
}

/**
 * The canonical, wide-format scientific dataset behind an ER Explorer
 * {@link Workspace}.
 *
 * ER Explorer's architecture treats wide datasets as canonical: one row per
 * analysis unit (typically one subject, or one subject-timepoint for
 * repeated measures), one column per {@link Variable}. Long/faceted views
 * used for plotting (e.g. one row per subject-endpoint for a
 * "Compare Endpoints" grid) are derived on demand from this canonical
 * shape and are never themselves stored as the source of truth
 * (`docs/ARCHITECTURE.md`).
 *
 * `StudyDataset` only describes the *shape and meaning* of the data (its
 * Variables and provenance). It deliberately holds no row values and
 * prescribes no storage format or loader, so that `packages/domain` has no
 * opinion on how data is parsed, stored, or fetched - that is the job of a
 * data-access layer built on top of this shape.
 */
export interface StudyDataset {
  /** Stable identifier for this dataset within a Workspace. */
  id: string;
  /** Human-readable name (e.g. `"Pooled efficacy analysis set"`). */
  name: string;
  /** Every Variable available in this dataset. Referenced by id elsewhere in the domain model rather than duplicated. */
  variables: Variable[];
  /** Number of rows (analysis units) in the dataset, so size can be displayed and sanity-checked without loading the data itself. */
  rowCount: number;
  /** Where this dataset came from and how reproducible it is. */
  provenance: DatasetProvenance;
  /** Free-text notes about this dataset: population definition, inclusion/exclusion caveats, known data-quality issues. */
  description?: string;
}
