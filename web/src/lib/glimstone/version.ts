/**
 * The version of the reference files sitting beside this one.
 *
 * It ships WITH them, and that is the whole point. An adopting app used to keep
 * this number as a constant of its own next to its About card, which meant the
 * number and the files it describes were two things that had to be changed
 * together by hand - and were not: one app's card claimed a version while its
 * copies were two rounds newer, so the one screen that exists to say what you
 * are looking at was saying the wrong thing.
 *
 * Copy this file along with the others and the number cannot drift, because it
 * is no longer a second place. An app that keeps its own constant anyway has
 * simply re-created the problem.
 *
 * Bumped here, in the release that changes the files.
 */
export const GLIMSTONE_VERSION = "1.11.0";
