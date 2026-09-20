/**
 * Small dense linear algebra, dependency-free (house rule: every `model-*`
 * package ships with zero dependencies so each family stays independently
 * auditable). Everything here operates on k×k systems where k is the spline
 * basis dimension — ~10 — so clarity beats cache-blocking cleverness.
 */

/** Lower-triangular L with A = L·Lᵀ, or null when A is not positive definite. */
export function cholesky(a: number[][]): number[][] | null {
  const n = a.length;
  const L: number[][] = Array.from({ length: n }, () => new Array<number>(n).fill(0));
  for (let i = 0; i < n; i++) {
    for (let j = 0; j <= i; j++) {
      let sum = a[i]![j]!;
      for (let m = 0; m < j; m++) sum -= L[i]![m]! * L[j]![m]!;
      if (i === j) {
        if (!(sum > 0) || !Number.isFinite(sum)) return null;
        L[i]![i] = Math.sqrt(sum);
      } else {
        L[i]![j] = sum / L[j]![j]!;
      }
    }
  }
  return L;
}

/** Solve A·x = b given the Cholesky factor L of A (forward then back substitution). */
export function choleskySolve(L: number[][], b: number[]): number[] {
  const n = L.length;
  const y = new Array<number>(n).fill(0);
  for (let i = 0; i < n; i++) {
    let sum = b[i]!;
    for (let j = 0; j < i; j++) sum -= L[i]![j]! * y[j]!;
    y[i] = sum / L[i]![i]!;
  }
  const x = new Array<number>(n).fill(0);
  for (let i = n - 1; i >= 0; i--) {
    let sum = y[i]!;
    for (let j = i + 1; j < n; j++) sum -= L[j]![i]! * x[j]!;
    x[i] = sum / L[i]![i]!;
  }
  return x;
}

/** log|A| from its Cholesky factor: 2·Σ log L_ii. */
export function choleskyLogDet(L: number[][]): number {
  let s = 0;
  for (let i = 0; i < L.length; i++) s += Math.log(L[i]![i]!);
  return 2 * s;
}

/**
 * Eigenvalues of a symmetric matrix by cyclic Jacobi rotations. Used only to
 * read the penalty's rank and its positive-eigenvalue product for the REML
 * score — both need the *spectrum*, not the vectors, and at k≈10 Jacobi is
 * both simpler and more robust than a tridiagonal-QL pipeline.
 */
export function symmetricEigenvalues(input: number[][]): number[] {
  const n = input.length;
  const a = input.map((row) => [...row]);
  for (let sweep = 0; sweep < 100; sweep++) {
    let off = 0;
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) off += a[i]![j]! * a[i]![j]!;
    if (off < 1e-30) break;
    for (let p = 0; p < n - 1; p++) {
      for (let q = p + 1; q < n; q++) {
        const apq = a[p]![q]!;
        if (Math.abs(apq) < 1e-300) continue;
        const theta = (a[q]![q]! - a[p]![p]!) / (2 * apq);
        const sign = theta >= 0 ? 1 : -1;
        const t = sign / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
        const c = 1 / Math.sqrt(t * t + 1);
        const s = t * c;
        for (let i = 0; i < n; i++) {
          const aip = a[i]![p]!;
          const aiq = a[i]![q]!;
          a[i]![p] = c * aip - s * aiq;
          a[i]![q] = s * aip + c * aiq;
        }
        for (let i = 0; i < n; i++) {
          const api = a[p]![i]!;
          const aqi = a[q]![i]!;
          a[p]![i] = c * api - s * aqi;
          a[q]![i] = s * api + c * aqi;
        }
      }
    }
  }
  return Array.from({ length: n }, (_, i) => a[i]![i]!);
}

/** Frobenius norm — used to put the penalty on the same scale as XᵀX so the
 * λ search grid is data-independent (mgcv does the same rescaling). */
export function frobenius(a: number[][]): number {
  let s = 0;
  for (const row of a) for (const v of row) s += v * v;
  return Math.sqrt(s);
}
