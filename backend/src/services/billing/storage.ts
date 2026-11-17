import type {ObjectStore} from "../../storage/types";
export class BillingError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export async function readValue<T>(bucket: ObjectStore, key: string, empty: T) {
  const object = await bucket.get(key);
  return {
    value: object ? await object.json<T>() : empty,
    revision: object?.etag,
  };
}

// Conditional writes keep simultaneous tabs and independent workers from spending the same credit.
export async function changeValue<T>(
  bucket: ObjectStore,
  key: string,
  empty: T,
  update: (value: T) => T,
) {
  for (let attempt = 0; attempt < 8; attempt++) {
    const { value, revision } = await readValue(bucket, key, empty);
    const next = update(value);
    if (next === value) return next;
    const result = await bucket.put(key, JSON.stringify(next), {
      onlyIf: revision ? { etagMatches: revision } : { etagDoesNotMatch: "*" },
    });
    if (result) return next;
  }
  throw new BillingError(
    503,
    "Plusieurs opérations sont en cours. Réessayez dans un instant.",
  );
}
