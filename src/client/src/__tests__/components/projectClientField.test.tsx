import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

/**
 * UAT U35 (2026-10-18): New Project had no Client box until the company had a client. Now New
 * Project (every path) and Edit project use the type-or-create box for people who may add clients.
 */
const api = vi.hoisted(() => ({
  getProjectGroups: vi.fn(async () => ({ groups: [] as Array<{ id: string; name: string }> })),
  createProjectGroup: vi.fn(async (d: { name: string }) => ({ id: 'g-new', name: d.name })),
  createProject: vi.fn(async () => ({ project: { id: 'p-new' } })),
  getTemplates: vi.fn(async () => ({ data: [{ id: 't1', name: 'Web build', category: 'other', projectType: 'other', estimatedDurationDays: 30, phaseCount: 1, taskCount: 1, tags: [] }] })),
  getTemplate: vi.fn(async () => ({ template: { id: 't1', name: 'Web build', estimatedDurationDays: 30, tasks: [{ refId: 'a', name: 'Build', description: '', estimatedDays: 5, parentRefId: null, dependencyRefId: null, isSummary: false }], raidItems: [] } })),
  applyTemplate: vi.fn(async () => ({ project: { id: 'p-new' } })),
  getMarketplaceTemplates: vi.fn(async () => ({ data: [] })),
  getProjectSponsor: vi.fn(async () => ({ sponsor: null })),
  getSponsorCandidates: vi.fn(async () => ({ candidates: [] })),
}));
vi.mock('../../services/api', () => ({ apiService: api }));

import { useAuthStore } from '../../stores/authStore';
import { TemplatePicker } from '../../components/templates/TemplatePicker';
import { EditProjectModal } from '../../components/project/EditProjectModal';

const setUser = (role: string, subscriptionTier = 'consultant_pro') =>
  useAuthStore.setState({ user: { id: 'u1', username: 'pat', email: 'p@x.test', role, subscriptionTier } } as never);
const wrap = (ui: React.ReactNode) => render(
  <QueryClientProvider client={new QueryClient()}><MemoryRouter>{ui}</MemoryRouter></QueryClientProvider>,
);

async function openBlankProject() {
  wrap(<TemplatePicker isOpen onClose={() => {}} />);
  fireEvent.click(screen.getByRole('button', { name: /Blank Project/ }));
  fireEvent.change(screen.getByLabelText(/Project Name/), { target: { value: 'Core banking' } });
}
const clientBox = (label = /^Client/) => screen.findByRole('combobox', { name: label });
const createBtn = () => screen.getByRole('button', { name: 'Create Project' });

describe('New Project — client', () => {
  beforeEach(() => { vi.clearAllMocks(); setUser('project_manager'); api.getProjectGroups.mockResolvedValue({ groups: [] }); });
  afterEach(cleanup);

  it('no clients yet: the box is there, a typed name is added as a client and the project goes under it', async () => {
    await openBlankProject();
    fireEvent.change(await clientBox(), { target: { value: 'Acme Bank' } });
    await waitFor(() => expect(createBtn()).not.toBeDisabled());
    fireEvent.click(createBtn());
    await waitFor(() => expect(api.createProject).toHaveBeenCalled());
    expect(api.createProjectGroup).toHaveBeenCalledWith({ name: 'Acme Bank' });
    expect(api.createProject).toHaveBeenCalledWith(expect.objectContaining({ name: 'Core banking', clientId: 'g-new' }));
  });

  it('an existing client is picked, not added again', async () => {
    api.getProjectGroups.mockResolvedValue({ groups: [{ id: 'g1', name: 'Acme Bank' }] });
    await openBlankProject();
    fireEvent.focus(await clientBox());
    fireEvent.mouseDown(await screen.findByRole('option', { name: 'Acme Bank' }));
    await waitFor(() => expect(createBtn()).not.toBeDisabled());
    fireEvent.click(createBtn());
    await waitFor(() => expect(api.createProject).toHaveBeenCalled());
    expect(api.createProjectGroup).not.toHaveBeenCalled();
    expect(api.createProject).toHaveBeenCalledWith(expect.objectContaining({ clientId: 'g1' }));
  });

  it('left blank: no client', async () => {
    await openBlankProject();
    await clientBox();
    await waitFor(() => expect(createBtn()).not.toBeDisabled());
    fireEvent.click(createBtn());
    await waitFor(() => expect(api.createProject).toHaveBeenCalled());
    expect(api.createProjectGroup).not.toHaveBeenCalled();
    expect(api.createProject).toHaveBeenCalledWith(expect.objectContaining({ clientId: undefined }));
  });

  async function openTemplate() {
    wrap(<TemplatePicker isOpen onClose={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /From Template/ }));
    fireEvent.click(await screen.findByRole('button', { name: /General/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'Select' }));
    await clientBox();
  }

  it('from a template: a new name is added first, then the template is applied with it', async () => {
    await openTemplate();
    fireEvent.change(await clientBox(), { target: { value: 'Acme Bank' } });
    await waitFor(() => expect(createBtn()).not.toBeDisabled());
    fireEvent.click(createBtn());
    await waitFor(() => expect(api.applyTemplate).toHaveBeenCalled());
    expect(api.createProjectGroup).toHaveBeenCalledWith({ name: 'Acme Bank' });
    expect(api.applyTemplate).toHaveBeenCalledWith(expect.objectContaining({ templateId: 't1', clientId: 'g-new' }));
  });

  it('from a template: a client name the server refuses is shown and no project is made', async () => {
    api.createProjectGroup.mockRejectedValueOnce({ response: { status: 409, data: { message: 'A client with this name already exists — choose another name.' } } });
    await openTemplate();
    fireEvent.change(await clientBox(), { target: { value: 'Acme Bank' } });
    await waitFor(() => expect(createBtn()).not.toBeDisabled());
    fireEvent.click(createBtn());
    expect(await screen.findByText('A client with this name already exists — choose another name.')).toBeTruthy();
    expect(api.applyTemplate).not.toHaveBeenCalled();
  });

  it('SME / Enterprise call it "Client or department"', async () => {
    setUser('pmo', 'sme');
    await openBlankProject();
    expect(await clientBox(/Client or department/)).toBeTruthy();
  });

  it('someone who may not add clients gets no box while there are none (as before)', async () => {
    setUser('team_member');
    await openBlankProject();
    await waitFor(() => expect(api.getProjectGroups).toHaveBeenCalled());
    expect(screen.queryByLabelText(/^Client/)).toBeNull();
  });
});

describe('Edit project — client', () => {
  beforeEach(() => { vi.clearAllMocks(); setUser('project_manager'); });
  afterEach(cleanup);
  const project = (extra: Record<string, unknown> = {}) => ({ id: 'p1', name: 'Core banking', ...extra });

  it('no clients yet: typing a name adds the client and assigns it', async () => {
    api.getProjectGroups.mockResolvedValue({ groups: [] });
    const onSave = vi.fn();
    wrap(<EditProjectModal project={project()} onSave={onSave} onClose={() => {}} />);
    fireEvent.change(await clientBox(), { target: { value: 'Acme Bank' } });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Save Changes' })).not.toBeDisabled());
    fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }));
    await waitFor(() => expect(onSave).toHaveBeenCalledWith({ clientId: 'g-new' }));
    expect(api.createProjectGroup).toHaveBeenCalledWith({ name: 'Acme Bank' });
  });

  it('shows the current client; clearing it saves no client', async () => {
    api.getProjectGroups.mockResolvedValue({ groups: [{ id: 'g1', name: 'Acme Bank' }] });
    const onSave = vi.fn();
    wrap(<EditProjectModal project={project({ groupId: 'g1' })} onSave={onSave} onClose={() => {}} />);
    const box = await clientBox();
    await waitFor(() => expect((box as HTMLInputElement).value).toBe('Acme Bank'));
    fireEvent.change(box, { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }));
    await waitFor(() => expect(onSave).toHaveBeenCalledWith({ clientId: null }));
    expect(api.createProjectGroup).not.toHaveBeenCalled();
  });

  it('picking another existing client assigns it; an untouched box changes nothing', async () => {
    api.getProjectGroups.mockResolvedValue({ groups: [{ id: 'g1', name: 'Acme Bank' }, { id: 'g2', name: 'Globex' }] });
    const onSave = vi.fn();
    const onClose = vi.fn();
    wrap(<EditProjectModal project={project({ groupId: 'g1' })} onSave={onSave} onClose={onClose} />);
    await clientBox();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Save Changes' })).not.toBeDisabled());
    fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(onSave).not.toHaveBeenCalled();
    cleanup();
    wrap(<EditProjectModal project={project({ groupId: 'g1' })} onSave={onSave} onClose={() => {}} />);
    fireEvent.change(await clientBox(), { target: { value: 'globex' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }));
    await waitFor(() => expect(onSave).toHaveBeenCalledWith({ clientId: 'g2' }));
    expect(api.createProjectGroup).not.toHaveBeenCalled();
  });

  it('a name the server refuses is shown, and nothing is saved', async () => {
    api.getProjectGroups.mockResolvedValue({ groups: [] });
    api.createProjectGroup.mockRejectedValueOnce({ response: { status: 409, data: { message: 'A client with this name already exists — choose another name.' } } });
    const onSave = vi.fn();
    wrap(<EditProjectModal project={project()} onSave={onSave} onClose={() => {}} />);
    fireEvent.change(await clientBox(), { target: { value: 'Acme Bank' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }));
    expect((await screen.findByRole('alert')).textContent).toBe('A client with this name already exists — choose another name.');
    expect(onSave).not.toHaveBeenCalled();
  });

  it('someone who may not add clients keeps the plain list', async () => {
    setUser('team_member');
    api.getProjectGroups.mockResolvedValue({ groups: [{ id: 'g1', name: 'Acme Bank' }] });
    wrap(<EditProjectModal project={project()} onSave={vi.fn()} onClose={() => {}} />);
    expect(await screen.findByRole('option', { name: 'Acme Bank' })).toBeTruthy();
    expect(screen.getByLabelText('Client').tagName).toBe('SELECT');
  });
});
