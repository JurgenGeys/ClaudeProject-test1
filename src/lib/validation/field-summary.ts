/** "Vul de 2 gemarkeerde velden in." (design chapter 3: summary above the form). */
export function fieldSummary(count: number): string {
  return count === 1 ? "Vul het gemarkeerde veld in." : `Vul de ${count} gemarkeerde velden in.`;
}
