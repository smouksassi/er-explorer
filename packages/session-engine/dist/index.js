export const createSessionMetadata = (createdBy, version) => ({
    createdAt: new Date().toISOString(),
    createdBy,
    version
});
export const createSessionState = (datasetId, model, visualization, filters = {}, settings = {}, metadata) => ({
    datasetId,
    model,
    visualization,
    filters,
    settings,
    metadata: metadata ?? createSessionMetadata("unknown", "0.0.1")
});
//# sourceMappingURL=index.js.map