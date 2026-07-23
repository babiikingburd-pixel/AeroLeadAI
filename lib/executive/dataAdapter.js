// DataAdapter — the entire "portability" mechanism of this engine, ported
// as-is. Each method returns plain JSON — no ORM objects — so agents can
// reason about any business the same way. lib/executive/adapter.js
// (AeroLeadAIAdapter) is the one implementation this app actually uses.
export class DataAdapter {
  /** @returns {Promise<object>} revenue, costs, cash position, burn rate, outstanding receivables */
  async getFinancials() {
    throw new Error("DataAdapter.getFinancials() not implemented");
  }

  /** @returns {Promise<object>} throughput, cycle times, capacity, quality/error rates */
  async getOperationsMetrics() {
    throw new Error("DataAdapter.getOperationsMetrics() not implemented");
  }

  /** @returns {Promise<object>} CAC, channel performance, pipeline, conversion rates */
  async getMarketingMetrics() {
    throw new Error("DataAdapter.getMarketingMetrics() not implemented");
  }

  /** @returns {Promise<object>} open compliance items, contract renewals, licensing status, disputes */
  async getLegalItems() {
    throw new Error("DataAdapter.getLegalItems() not implemented");
  }

  /** @returns {Promise<object>} market position, competitor moves, stated company goals/priorities */
  async getStrategicContext() {
    throw new Error("DataAdapter.getStrategicContext() not implemented");
  }
}
