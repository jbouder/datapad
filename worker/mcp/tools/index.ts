import type { McpTool } from '../tool';
import { getDigest, searchTool } from './digest';
import { getFocus, getLoops, getRoom, getToday, listUnfiled } from './loops';
import { listMeetings, listNotes } from './notes';
import { listOrgs, listPeople } from './people';
import { getOverview, getProject, listProjects } from './projects';
import {
  addList,
  addListItem,
  checkListItem,
  getList,
  listLists,
} from './retired';
import { listSpaces, whoami } from './spaces';
import { getRecap, listTasks } from './tasks';
import {
  addMeeting,
  addNote,
  addTopic,
  coverTopic,
  fileNote,
} from './write-meetings';
import {
  addMilestone,
  createProject,
  setProjectHealth,
  setProjectStatus,
} from './write-projects';
import {
  addTask,
  completeTask,
  editTask,
  reopenTask,
  setBlocked,
  setDecide,
} from './write-tasks';

/**
 * Every tool `/mcp` offers, in the order `tools/list` shows them. A new
 * tool is a `defineTool` in a file here, added to this list: reads (#153)
 * with `scope: 'read'`, writes (#154) with `scope: 'write'`. A token sees
 * and may call only the tools its scopes allow. v2 (#340) adds Today, the
 * loops, Unfiled and the rooms; the list tools are retired (`retired.ts`)
 * and go in the next release.
 */
export const TOOLS: readonly McpTool[] = [
  whoami,
  listSpaces,
  getOverview,
  getToday,
  getFocus,
  getRecap,
  getLoops,
  listUnfiled,
  getRoom,
  listProjects,
  getProject,
  listTasks,
  listNotes,
  listMeetings,
  listPeople,
  listOrgs,
  getDigest,
  searchTool,
  listLists,
  getList,
  addTask,
  completeTask,
  reopenTask,
  editTask,
  setBlocked,
  setDecide,
  addNote,
  fileNote,
  addMeeting,
  addTopic,
  coverTopic,
  createProject,
  setProjectStatus,
  setProjectHealth,
  addMilestone,
  addList,
  addListItem,
  checkListItem,
];
