export class AgentQueueGate {
  private pendingCount = 0

  constructor(private readonly maxConcurrent: number) {}

  get pending(): number {
    return this.pendingCount
  }

  tryReserve(activeCount: number): boolean {
    if (activeCount + this.pendingCount >= this.maxConcurrent) return false
    this.pendingCount += 1
    return true
  }

  release(): void {
    this.pendingCount = Math.max(0, this.pendingCount - 1)
  }
}
