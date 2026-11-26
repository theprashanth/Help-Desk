import { Schema } from 'mongoose';
import { getActiveWorkspaceId } from '../context/tenant.context';

export function tenantPlugin(schema: Schema) {
  if ((schema as any).__noTenant) return; // e.g. workspaces themselves
  // Ensure workspaceId path is present
  if (!schema.path('workspaceId')) {
    schema.add({
      workspaceId: { type: String, required: true, index: true }
    });
  }

  // Set workspaceId on new documents before validation (validation runs before 'save' hooks,
  // so stamping it in 'save' failed with "workspaceId is required")
  schema.pre('validate', function (next) {
    if (!this.workspaceId) {
      this.workspaceId = getActiveWorkspaceId();
    }
    next();
  });

  // Hook pre-query: apply workspaceId filter automatically
  // Every query that reads or changes documents (findById* and exists() go through findOne / findOneAnd*)
  const queryMethods = ['find', 'findOne', 'findOneAndUpdate', 'findOneAndDelete', 'findOneAndReplace', 'replaceOne', 'updateOne', 'updateMany', 'deleteOne', 'deleteMany', 'countDocuments', 'distinct'];
  queryMethods.forEach(method => {
    schema.pre(method as any, function (this: any, next) {
      const workspaceId = getActiveWorkspaceId();
      // Skip filtering for WorkspaceModel itself or if explicit bypass is set
      if (this.model.modelName !== 'Workspace' && workspaceId && !this.getFilter().workspaceId) {
        this.where({ workspaceId });
      }
      next();
    });
  });
}
