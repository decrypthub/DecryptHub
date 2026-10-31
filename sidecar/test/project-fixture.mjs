import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { SessionManager } from '../sessions.mjs';

export function bindTestProject(session, folder) {
  const manager = session.mgr;
  folder ||= manager.workspaces.folder(session.workspace.root);
  const project = manager.projects.save({ name: 'Fixture project', folders: [folder], primaryId: folder.id });
  return session.setWorkspace(manager.projects.workspace(project.id));
}

export class TestSessionManager extends SessionManager {
  constructor(options) {
    super(options);
    if (this.projects.list().length) return;
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dh-test-project-'));
    const folder = this.workspaces.folder(root), project = this.projects.save({ name: 'Fixture project', folders: [folder], primaryId: folder.id });
    this.create({ projectId: project.id, primary: true });
    const close = this.closeAll.bind(this);
    this.closeAll = async () => { await close(); if (path.dirname(root) === os.tmpdir() && path.basename(root).startsWith('dh-test-project-')) fs.rmSync(root, { recursive: true, force: true }); };
  }
}
