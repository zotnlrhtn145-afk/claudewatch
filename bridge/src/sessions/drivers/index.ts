import type { DriverKind } from '../../config.js';
import { RemoteControlDriver } from './remote-control.js';
import { SdkDriver } from './sdk.js';
import type { DriverHooks, SessionDriver } from './types.js';

export function createDriver(kind: DriverKind, hooks: DriverHooks): SessionDriver {
  return kind === 'remote-control' ? new RemoteControlDriver(hooks) : new SdkDriver(hooks);
}

export type { DriverHooks, SessionDriver } from './types.js';
