import type { McpTool } from '../tool';
import { getDigest, searchTool } from './digest';
import { listMeetings, listNotes } from './notes';
import { listOrgs, listPeople } from './people';
import { getOverview, getProject, listProjects } from './projects';
import { listSpaces, whoami } from './spaces';
import { getFocus, getRecap, listTasks } from './tasks';
import { addMeeting, addNote, addTopic, coverTopic } from './write-meetings';
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
} from './write-tasks';

/**
 * Every tool `/mcp` offers, in the order `tools/list` shows them. A new
 * tool is a `defineTool` in a file here, added to this list: reads (#153)
 * with `scope: 'read'`, writes (#154) with `scope: 'write'`. A token sees
 * and may call only the tools its scopes allow.
 */
export const TOOLS: readonly McpTool[] = [
  whoami,
  listSpaces,
  getOverview,
  getFocus,
  getRecap,
  listProjects,
  getProject,
  listTasks,
  listNotes,
  listMeetings,
  listPeople,
  listOrgs,
  getDigest,
  searchTool,
  addTask,
  completeTask,
  reopenTask,
  editTask,
  setBlocked,
  addNote,
  addMeeting,
  addTopic,
  coverTopic,
  createProject,
  setProjectStatus,
  setProjectHealth,
  addMilestone,
];
