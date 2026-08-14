/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as admin from "../admin.js";
import type * as authCodes from "../authCodes.js";
import type * as callCompliance from "../callCompliance.js";
import type * as callState from "../callState.js";
import type * as callTranslation from "../callTranslation.js";
import type * as calls from "../calls.js";
import type * as caseDocuments from "../caseDocuments.js";
import type * as cases from "../cases.js";
import type * as contacts from "../contacts.js";
import type * as externalVideoInvites from "../externalVideoInvites.js";
import type * as faceLibrary from "../faceLibrary.js";
import type * as features from "../features.js";
import type * as groupCallState from "../groupCallState.js";
import type * as groupCalls from "../groupCalls.js";
import type * as groupCallsNode from "../groupCallsNode.js";
import type * as groups from "../groups.js";
import type * as http from "../http.js";
import type * as messages from "../messages.js";
import type * as notifications from "../notifications.js";
import type * as presence from "../presence.js";
import type * as push from "../push.js";
import type * as pushSubscriptions from "../pushSubscriptions.js";
import type * as roleManagement from "../roleManagement.js";
import type * as roles from "../roles.js";
import type * as secureGroupCalls from "../secureGroupCalls.js";
import type * as users from "../users.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  admin: typeof admin;
  authCodes: typeof authCodes;
  callCompliance: typeof callCompliance;
  callState: typeof callState;
  callTranslation: typeof callTranslation;
  calls: typeof calls;
  caseDocuments: typeof caseDocuments;
  cases: typeof cases;
  contacts: typeof contacts;
  externalVideoInvites: typeof externalVideoInvites;
  faceLibrary: typeof faceLibrary;
  features: typeof features;
  groupCallState: typeof groupCallState;
  groupCalls: typeof groupCalls;
  groupCallsNode: typeof groupCallsNode;
  groups: typeof groups;
  http: typeof http;
  messages: typeof messages;
  notifications: typeof notifications;
  presence: typeof presence;
  push: typeof push;
  pushSubscriptions: typeof pushSubscriptions;
  roleManagement: typeof roleManagement;
  roles: typeof roles;
  secureGroupCalls: typeof secureGroupCalls;
  users: typeof users;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};
