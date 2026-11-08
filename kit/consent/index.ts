/**
 * kit/consent — consent screen component and consent record store.
 *
 * Re-exports everything the rest of the kit and apps need so they can import
 * from 'kit/consent' rather than the individual files.
 */

export type { ConsentRecord } from './ConsentRecord';
export { setConsent, getConsentRecord } from './ConsentRecord';
export { mountConsentScreen } from './ConsentScreen';
