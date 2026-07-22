import { getLogger } from '../logging/logger.js';
import type { AssetProducingPort } from '../../../application/ports/asset-producing.port.js';
import type { JobLifecycleDocument } from '../persistence/schemas.js';

const logger = getLogger();

export class AssetProducingAdapter implements AssetProducingPort {
  async toAsset(job: Partial<JobLifecycleDocument>): Promise<string> {
    const assetPath = `/tmp/assets/${job._id || 'unknown'}.pdf`;
    logger.info('[AssetProducingAdapter] toAsset stub', { jobId: job._id, assetPath });
    return assetPath;
  }
}
