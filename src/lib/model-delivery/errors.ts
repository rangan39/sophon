export class ModelDeliveryUnavailableError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "ModelDeliveryUnavailableError";
  }
}

export class ModelStorageQuotaError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "ModelStorageQuotaError";
  }
}

export class InsufficientModelStorageError extends Error {
  readonly availableBytes: number;
  readonly requiredBytes: number;

  constructor(requiredBytes: number, availableBytes: number) {
    super(`This model needs about ${formatBytes(requiredBytes)} of additional browser storage, but only ${formatBytes(availableBytes)} is currently available.`);
    this.name = "InsufficientModelStorageError";
    this.requiredBytes = requiredBytes;
    this.availableBytes = availableBytes;
  }
}

export function isStorageQuotaError(error: unknown) {
  return error instanceof DOMException && error.name === "QuotaExceededError";
}

export function toModelStorageError(error: unknown, message = "The browser ran out of storage while saving this model.") {
  return isStorageQuotaError(error)
    ? new ModelStorageQuotaError(message, { cause: error })
    : error;
}

function formatBytes(bytes: number) {
  if (bytes < 1024 ** 2) return `${Math.ceil(bytes / 1024)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(0)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
}
