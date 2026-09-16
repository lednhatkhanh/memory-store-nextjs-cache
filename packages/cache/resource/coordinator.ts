export type RedisConnection = Readonly<{
  host: string;
  port: number;
}>;

export type DisposableRedisResource = Readonly<{
  connection: RedisConnection;
  stop: () => Promise<void>;
}>;

export type MeasurementChild = Readonly<{
  message: Promise<unknown>;
  terminate: () => Promise<void>;
}>;

export type ResourceCoordinatorOptions<Evidence> = Readonly<{
  createChild: (connection: RedisConnection) => MeasurementChild | Promise<MeasurementChild>;
  createRedisResource: () => Promise<DisposableRedisResource>;
  parseEvidence: (value: unknown) => Evidence;
  timeoutMilliseconds: number;
}>;

type RunOutcome<Evidence> =
  | Readonly<{ evidence: Evidence; status: "fulfilled" }>
  | Readonly<{ error: unknown; status: "rejected" }>;

function timeoutAfter(milliseconds: number): {
  promise: Promise<never>;
  stop: () => void;
} {
  const timeout = Promise.withResolvers<never>();
  const timer = setTimeout(() => {
    timeout.reject(new Error(`Resource measurement timed out after ${milliseconds}ms`));
  }, milliseconds);
  return {
    promise: timeout.promise,
    stop() {
      clearTimeout(timer);
    },
  };
}

export async function coordinateResourceMeasurement<Evidence>(
  options: ResourceCoordinatorOptions<Evidence>,
): Promise<Evidence> {
  if (!Number.isSafeInteger(options.timeoutMilliseconds) || options.timeoutMilliseconds <= 0) {
    throw new Error("Resource measurement timeout must be a positive safe integer");
  }

  let child: MeasurementChild | undefined;
  let redis: DisposableRedisResource | undefined;
  let outcome: RunOutcome<Evidence>;

  try {
    redis = await options.createRedisResource();
    child = await options.createChild(redis.connection);
    const timeout = timeoutAfter(options.timeoutMilliseconds);
    try {
      const message = await Promise.race([child.message, timeout.promise]);
      outcome = { evidence: options.parseEvidence(message), status: "fulfilled" };
    } finally {
      timeout.stop();
    }
  } catch (error) {
    outcome = { error, status: "rejected" };
  }

  const childCleanup = await Promise.allSettled([child?.terminate()]);
  const redisCleanup = await Promise.allSettled([redis?.stop()]);
  const cleanupErrors = [...childCleanup, ...redisCleanup].flatMap((result) =>
    result.status === "rejected" ? [result.reason] : [],
  );

  if (outcome.status === "rejected") {
    if (cleanupErrors.length > 0) {
      throw new AggregateError(
        [outcome.error, ...cleanupErrors],
        "Resource measurement and cleanup failed",
      );
    }
    throw outcome.error;
  }
  if (cleanupErrors.length > 0) {
    throw new AggregateError(cleanupErrors, "Resource measurement cleanup failed");
  }
  return outcome.evidence;
}
