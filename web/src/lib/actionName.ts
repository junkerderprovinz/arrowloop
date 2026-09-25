/**
 * The name a planned action shows: as the side that holds the file spells it.
 * `path` is the key both sides are matched on, and it is folded to lower case
 * wherever one side ignores case, as a phone's shared storage does.
 */
export function actionName(action: { path: string; left?: { path: string }; right?: { path: string } }): string {
  return action.left?.path ?? action.right?.path ?? action.path
}
