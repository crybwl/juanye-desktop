interface ParkingTarget {
  inert: boolean;
  style: { contentVisibility: string };
}

/** A canceled/outdated exit must never hide a subsequently re-entered workspace. */
export class WorkspaceParking {
  private revision = 0;
  constructor(private readonly target: ParkingTarget) {}

  begin(active: boolean): () => boolean {
    const revision = ++this.revision;
    if (active) {
      // Remove native inertness while the subtree is still skipped, before entry.
      this.target.inert = false;
      this.target.style.contentVisibility = "visible";
    }
    return () => {
      if (active || revision !== this.revision) return false;
      // This order prevents native inertness invalidating the still-rendered tree.
      this.target.style.contentVisibility = "hidden";
      this.target.inert = true;
      return true;
    };
  }

  cancel() { ++this.revision; }
}
