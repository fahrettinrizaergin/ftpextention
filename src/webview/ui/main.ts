import type { ConnectionInput, ConnectionMetadata, ConnectionProtocol, RemoteEntry } from '../../models/connectionModel';
import type { WebviewRequestMessage, WebviewResponseMessage } from '../messages';

interface VsCodeApi<T> {
  postMessage(message: T): void;
  setState(state: unknown): void;
  getState(): unknown;
}

declare function acquireVsCodeApi<T>(): VsCodeApi<T>;

type ConnectionStatus = 'connected' | 'disconnected' | 'error';
type ClipboardAction = 'copy' | 'cut';
const entryNameCollator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

interface ClipboardPayload {
  action: ClipboardAction;
  entry: RemoteEntry;
}

interface ContextTarget {
  entry: RemoteEntry;
}

interface UiState {
  connections: ConnectionMetadata[];
  statuses: Map<string, ConnectionStatus>;
  selectedConnectionId: string | null;
  rootPath: string;
  expandedFolders: Set<string>;
  directoryCache: Map<string, RemoteEntry[]>;
  pendingPaths: Set<string>;
  editingConnectionId: string | null;
  clipboard: ClipboardPayload | null;
  contextTarget: ContextTarget | null;
}

const vscode = acquireVsCodeApi<WebviewRequestMessage>();

const state: UiState = {
  connections: [],
  statuses: new Map<string, ConnectionStatus>(),
  selectedConnectionId: null,
  rootPath: '/',
  expandedFolders: new Set<string>(),
  directoryCache: new Map<string, RemoteEntry[]>(),
  pendingPaths: new Set<string>(),
  editingConnectionId: null,
  clipboard: null,
  contextTarget: null
};

const connectionsList = getElement<HTMLUListElement>('connectionsList');
const connectionsEmptyState = getElement<HTMLDivElement>('connectionsEmptyState');
const connectionsAccordionBody = getElement<HTMLDivElement>('connectionsAccordionBody');
const toggleConnectionsBtn = getElement<HTMLButtonElement>('toggleConnectionsBtn');
const managerEmptyState = getElement<HTMLDivElement>('managerEmptyState');
const treeContainer = getElement<HTMLDivElement>('treeContainer');
const refreshConnectionsBtn = getElement<HTMLButtonElement>('refreshConnectionsBtn');
const openCreateModalBtn = getElement<HTMLButtonElement>('openCreateModalBtn');
const connectionModal = getElement<HTMLDivElement>('connectionModal');
const closeModalBtn = getElement<HTMLButtonElement>('closeModalBtn');
const connectionForm = getElement<HTMLFormElement>('connectionForm');
const modalTitle = getElement<HTMLHeadingElement>('modalTitle');
const formFeedback = getElement<HTMLSpanElement>('formFeedback');
const testConnectionBtn = getElement<HTMLButtonElement>('testConnectionBtn');
const saveConnectionBtn = getElement<HTMLButtonElement>('saveConnectionBtn');
const toastRoot = getElement<HTMLDivElement>('toastRoot');
const pathInput = getElement<HTMLInputElement>('pathInput');
const goPathBtn = getElement<HTMLButtonElement>('goPathBtn');
const uploadBtn = getElement<HTMLButtonElement>('uploadBtn');
const createFolderBtn = getElement<HTMLButtonElement>('createFolderBtn');
const createFileBtn = getElement<HTMLButtonElement>('createFileBtn');
const contextMenu = getElement<HTMLDivElement>('contextMenu');

const nameInput = getElement<HTMLInputElement>('nameInput');
const protocolInput = getElement<HTMLSelectElement>('protocolInput');
const serverAddressInput = getElement<HTMLInputElement>('serverAddressInput');
const portInput = getElement<HTMLInputElement>('portInput');
const usernameInput = getElement<HTMLInputElement>('usernameInput');
const passwordInput = getElement<HTMLInputElement>('passwordInput');
const remotePathInput = getElement<HTMLInputElement>('remotePathInput');
const localPathInput = getElement<HTMLInputElement>('localPathInput');
const pickLocalPathBtn = getElement<HTMLButtonElement>('pickLocalPathBtn');
const pickRemotePathBtn = getElement<HTMLButtonElement>('pickRemotePathBtn');

function initialize(): void {
  bindEvents();
  applyDefaultPort();
  renderConnections();
  renderFileManager();
  postMessage({ type: 'ready' });
}

function bindEvents(): void {
  refreshConnectionsBtn.addEventListener('click', () => {
    postMessage({ type: 'getConnections' });
  });

  toggleConnectionsBtn.addEventListener('click', () => {
    const collapsed = connectionsAccordionBody.classList.toggle('collapsed');
    toggleConnectionsBtn.setAttribute('aria-expanded', String(!collapsed));
  });

  openCreateModalBtn.addEventListener('click', () => {
    openModal();
  });

  closeModalBtn.addEventListener('click', () => {
    closeModal();
  });

  protocolInput.addEventListener('change', () => {
    applyDefaultPort();
  });

  connectionForm.addEventListener('submit', (event) => {
    event.preventDefault();
    saveConnection();
  });

  testConnectionBtn.addEventListener('click', () => {
    testConnection();
  });

  pickLocalPathBtn.addEventListener('click', () => {
    postMessage({ type: 'pickLocalPath' });
  });

  pickRemotePathBtn.addEventListener('click', () => {
    remotePathInput.value = normalizePath(state.rootPath || '/');
    showToast(`Remote path set: ${remotePathInput.value}`, 'success');
  });

  goPathBtn.addEventListener('click', () => {
    navigateToPath(pathInput.value);
  });

  uploadBtn.addEventListener('click', () => {
    if (!state.selectedConnectionId) {
      showToast('Select a connection before uploading.', 'error');
      return;
    }

    postMessage({
      type: 'uploadFile',
      payload: {
        connectionId: state.selectedConnectionId,
        remoteDirectory: state.rootPath
      }
    });
  });

  createFolderBtn.addEventListener('click', () => {
    createNewFolder(state.rootPath);
  });

  createFileBtn.addEventListener('click', () => {
    createNewFile(state.rootPath);
  });

  window.addEventListener('message', (event: MessageEvent<WebviewResponseMessage>) => {
    handleIncomingMessage(event.data);
  });

  contextMenu.addEventListener('click', (event) => {
    event.stopPropagation();
  });

  contextMenu.addEventListener('mousedown', (event) => {
    event.stopPropagation();
  });

  contextMenu.addEventListener('contextmenu', (event) => {
    event.preventDefault();
    event.stopPropagation();
  });

  treeContainer.addEventListener('contextmenu', (event) => {
    const target = event.target as HTMLElement | null;
    const rowElement = target?.closest('.tree-row');
    if (rowElement) {
      return;
    }

    if (!state.selectedConnectionId) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    openDirectoryContextMenu(event.clientX, event.clientY, state.rootPath);
  });

  document.addEventListener('click', () => {
    hideContextMenu();
  });

  document.addEventListener('contextmenu', (event) => {
    if (event.defaultPrevented) {
      return;
    }

    const target = event.target as Node | null;
    if (!target || !contextMenu.contains(target)) {
      hideContextMenu();
    }
  });

  window.addEventListener('resize', () => {
    hideContextMenu();
  });
}

function saveConnection(): void {
  const payload = collectConnectionFormPayload();
  const errors = validateFormPayload(payload, state.editingConnectionId === null);

  if (errors.length > 0) {
    setFormFeedback(errors.join(' '), false);
    return;
  }

  setBusyFormState(true);
  setFormFeedback('Saving connection...', true);

  if (state.editingConnectionId) {
    postMessage({
      type: 'updateConnection',
      payload: {
        ...payload,
        id: state.editingConnectionId
      }
    });
    return;
  }

  postMessage({ type: 'addConnection', payload });
}

function testConnection(): void {
  const payload = collectConnectionFormPayload();
  const errors = validateFormPayload(payload, true);

  if (errors.length > 0) {
    setFormFeedback(errors.join(' '), false);
    return;
  }

  setBusyFormState(true);
  setFormFeedback('Testing connection...', true);
  postMessage({ type: 'testConnection', payload });
}

function collectConnectionFormPayload(): ConnectionInput {
  const protocol = protocolInput.value as ConnectionProtocol;

  return {
    name: nameInput.value.trim(),
    protocol,
    serverAddress: serverAddressInput.value.trim(),
    port: Number(portInput.value),
    username: usernameInput.value.trim(),
    password: passwordInput.value,
    remotePath: remotePathInput.value.trim() || '/',
    localPath: localPathInput.value.trim()
  };
}

function validateFormPayload(payload: ConnectionInput, requirePassword: boolean): string[] {
  const errors: string[] = [];
  if (!payload.serverAddress) {
    errors.push('Server address is required.');
  }

  if (!Number.isInteger(payload.port) || payload.port < 1 || payload.port > 65535) {
    errors.push('Port must be between 1 and 65535.');
  }

  if (!payload.username) {
    errors.push('Username is required.');
  }

  if (requirePassword && !payload.password) {
    errors.push('Password is required.');
  }

  if (!payload.remotePath) {
    errors.push('Remote path is required.');
  }

  if (!payload.localPath) {
    errors.push('Local path is required.');
  }

  return errors;
}

function openModal(connection?: ConnectionMetadata): void {
  connectionModal.classList.remove('hidden');
  setFormFeedback('', true);

  if (!connection) {
    state.editingConnectionId = null;
    modalTitle.textContent = 'Add Connection';
    connectionForm.reset();
    protocolInput.value = 'ssh';
    passwordInput.required = true;
    passwordInput.placeholder = '';
    applyDefaultPort();
    remotePathInput.value = normalizePath(state.rootPath || '/');
    return;
  }

  state.editingConnectionId = connection.id;
  modalTitle.textContent = 'Edit Connection';
  nameInput.value = connection.name;
  protocolInput.value = connection.protocol;
  serverAddressInput.value = connection.serverAddress;
  portInput.value = String(connection.port);
  usernameInput.value = connection.username;
  passwordInput.value = '';
  passwordInput.required = false;
  passwordInput.placeholder = 'Leave blank to keep existing password';
  remotePathInput.value = connection.remotePath;
  localPathInput.value = connection.localPath;
}

function closeModal(): void {
  connectionModal.classList.add('hidden');
  setBusyFormState(false);
}

function setBusyFormState(isBusy: boolean): void {
  testConnectionBtn.disabled = isBusy;
  saveConnectionBtn.disabled = isBusy;
}

function setFormFeedback(message: string, isSuccess: boolean): void {
  formFeedback.textContent = message;
  formFeedback.classList.toggle('success', isSuccess);
}

function applyDefaultPort(): void {
  const protocol = protocolInput.value as ConnectionProtocol;
  portInput.value = String(defaultPortForProtocol(protocol));
}

function defaultPortForProtocol(protocol: ConnectionProtocol): number {
  if (protocol === 'ftp') {
    return 21;
  }

  return 22;
}

function handleIncomingMessage(message: WebviewResponseMessage): void {
  switch (message.type) {
    case 'connectionsLoaded': {
      state.connections = message.payload;
      synchronizeStatuses();
      renderConnections();
      renderFileManager();
      return;
    }

    case 'connectionSaved': {
      closeModal();
      setBusyFormState(false);
      showToast('Connection saved.', 'success');
      return;
    }

    case 'connectionRemoved': {
      if (state.selectedConnectionId === message.payload.id) {
        state.selectedConnectionId = null;
        state.rootPath = '/';
        state.directoryCache.clear();
        state.expandedFolders.clear();
      }

      showToast('Connection removed.', 'success');
      renderConnections();
      renderFileManager();
      return;
    }

    case 'connectionTestResult': {
      setBusyFormState(false);

      if (message.payload.ok) {
        setFormFeedback(message.payload.message, true);
        showToast(message.payload.message, 'success');
      } else {
        setFormFeedback(message.payload.message, false);
        showToast(message.payload.message, 'error');
      }

      return;
    }

    case 'directoryLoaded': {
      state.pendingPaths.delete(message.payload.path);
      state.directoryCache.set(message.payload.path, sortEntries(message.payload.entries));
      state.statuses.set(message.payload.connectionId, 'connected');
      renderConnections();
      renderFileManager();
      return;
    }

    case 'localPathPicked': {
      localPathInput.value = message.payload.localPath;
      showToast('Local path selected.', 'success');
      return;
    }

    case 'connectionStatus': {
      state.statuses.set(message.payload.connectionId, message.payload.status);
      if (message.payload.status === 'disconnected' && state.selectedConnectionId === message.payload.connectionId) {
        state.selectedConnectionId = null;
        state.rootPath = '/';
        state.directoryCache.clear();
        state.expandedFolders.clear();
        pathInput.value = '/';
        renderFileManager();
      }
      renderConnections();
      return;
    }

    case 'operationSuccess': {
      setBusyFormState(false);
      showToast(message.payload.message, 'success');
      if (!message.payload.message.startsWith('Downloaded')) {
        refreshCurrentRoot();
      }
      return;
    }

    case 'operationError': {
      setBusyFormState(false);
      setFormFeedback(message.payload.message, false);
      showToast(message.payload.message, 'error');
      return;
    }
  }
}

function synchronizeStatuses(): void {
  const validIds = new Set(state.connections.map((connection) => connection.id));
  for (const existingId of state.statuses.keys()) {
    if (!validIds.has(existingId)) {
      state.statuses.delete(existingId);
    }
  }

  for (const connection of state.connections) {
    if (!state.statuses.has(connection.id)) {
      state.statuses.set(connection.id, 'disconnected');
    }
  }
}

function renderConnections(): void {
  connectionsList.textContent = '';
  connectionsEmptyState.style.display = state.connections.length === 0 ? 'block' : 'none';

  for (const connection of state.connections) {
    const item = document.createElement('li');
    item.className = 'connection-item';
    if (connection.id === state.selectedConnectionId) {
      item.classList.add('active');
    }

    item.addEventListener('click', () => {
      selectConnection(connection.id);
    });

    const metaRow = document.createElement('div');
    metaRow.className = 'connection-meta';

    const titleWrap = document.createElement('div');
    const title = document.createElement('div');
    title.className = 'connection-title';
    title.textContent = connection.name;

    const subtitle = document.createElement('div');
    subtitle.className = 'connection-subtitle';
    subtitle.textContent = `${connection.protocol.toUpperCase()} ${connection.serverAddress}:${String(connection.port)}`;

    titleWrap.appendChild(title);
    titleWrap.appendChild(subtitle);

    const status = document.createElement('span');
    const statusValue = state.statuses.get(connection.id) ?? 'disconnected';
    status.className = `status-pill status-${statusValue}`;
    status.textContent = statusValue;

    metaRow.appendChild(titleWrap);
    metaRow.appendChild(status);

    const actions = document.createElement('div');
    actions.className = 'connection-actions';

    const testButton = createActionButton('Test', () => {
      postMessage({ type: 'testSavedConnection', payload: { id: connection.id } });
    });

    const editButton = createActionButton('Edit', () => {
      openModal(connection);
    });

    const terminalButton = createActionButton('Terminal', () => {
      postMessage({ type: 'openTerminal', payload: { id: connection.id } });
    });

    const deleteButton = createActionButton('Delete', () => {
      if (!window.confirm(`Delete ${connection.name}?`)) {
        return;
      }

      postMessage({ type: 'removeConnection', payload: { id: connection.id } });
    });

    const disconnectButton = createActionButton('Disconnect', () => {
      postMessage({ type: 'disconnectConnection', payload: { id: connection.id } });
    });

    const actionButtons = [testButton, editButton];
    if (connection.protocol === 'ssh' || connection.protocol === 'sftp') {
      actionButtons.push(terminalButton);
    }
    actionButtons.push(disconnectButton);
    actionButtons.push(deleteButton);

    for (const button of actionButtons) {
      button.addEventListener('click', (event) => {
        event.stopPropagation();
      });
      actions.appendChild(button);
    }

    item.appendChild(metaRow);
    item.appendChild(actions);
    connectionsList.appendChild(item);
  }
}

function selectConnection(connectionId: string): void {
  const selected = state.connections.find((connection) => connection.id === connectionId);
  if (!selected) {
    return;
  }

  state.selectedConnectionId = connectionId;
  state.rootPath = selected.remotePath || '/';
  pathInput.value = state.rootPath;
  state.directoryCache.clear();
  state.expandedFolders.clear();
  requestDirectory(state.rootPath);
  renderConnections();
  renderFileManager();
}

function renderFileManager(): void {
  treeContainer.textContent = '';
  const hasSelection = Boolean(state.selectedConnectionId);

  managerEmptyState.style.display = 'none';
  uploadBtn.disabled = !hasSelection;
  createFolderBtn.disabled = !hasSelection;
  createFileBtn.disabled = !hasSelection;
  pathInput.disabled = !hasSelection;
  goPathBtn.disabled = !hasSelection;

  if (!hasSelection || !state.selectedConnectionId) {
    return;
  }

  const treeFragment = renderTreeLevel(state.rootPath, 0);
  const nodeCount = treeFragment.childNodes.length;
  if (nodeCount > 0) {
    treeContainer.appendChild(treeFragment);
  }

  if (!state.directoryCache.has(state.rootPath) && !state.pendingPaths.has(state.rootPath)) {
    requestDirectory(state.rootPath);
  }

  if (nodeCount === 0) {
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    empty.textContent = state.pendingPaths.has(state.rootPath) ? 'Loading directory...' : 'No files found.';
    treeContainer.appendChild(empty);
  }
}

function renderTreeLevel(parentPath: string, depth: number): DocumentFragment {
  const fragment = document.createDocumentFragment();
  const entries = state.directoryCache.get(parentPath) ?? [];

  for (const entry of entries) {
    const row = document.createElement('div');
    row.className = 'tree-row';
    row.addEventListener('contextmenu', (event) => {
      event.preventDefault();
      event.stopPropagation();
      openContextMenu(event.clientX, event.clientY, entry);
    });

    const main = document.createElement('div');
    main.className = 'tree-main';

    const indent = document.createElement('span');
    indent.className = 'row-indent';
    indent.style.setProperty('--depth', String(depth));

    const toggle = document.createElement('button');
    toggle.className = 'tree-toggle';

    const icon = document.createElement('span');
    icon.className = `entry-icon ${entry.type === 'directory' ? 'folder' : 'file'}`;
    icon.textContent = getEntryIcon(entry);

    const name = document.createElement('span');
    name.className = 'tree-name';
    name.textContent = entry.name;

    if (entry.type === 'directory') {
      const isExpanded = state.expandedFolders.has(entry.path);
      toggle.textContent = isExpanded ? '⌄' : '›';
      toggle.addEventListener('click', (event) => {
        event.stopPropagation();
        toggleFolder(entry.path);
      });

      name.addEventListener('dblclick', () => {
        navigateToPath(entry.path);
      });
    } else {
      toggle.className = 'tree-toggle placeholder';
      toggle.textContent = '';
      row.addEventListener('click', () => {
        if (!state.selectedConnectionId) {
          return;
        }

        showToast(`Opening file: ${entry.name}`, 'success');
        postMessage({
          type: 'openRemoteFile',
          payload: {
            connectionId: state.selectedConnectionId,
            remotePath: entry.path
          }
        });
      });
    }

    main.appendChild(indent);
    main.appendChild(toggle);
    main.appendChild(icon);
    main.appendChild(name);
    row.appendChild(main);

    fragment.appendChild(row);

    if (entry.type === 'directory' && state.expandedFolders.has(entry.path)) {
      fragment.appendChild(renderTreeLevel(entry.path, depth + 1));
    }
  }

  return fragment;
}

function openContextMenu(x: number, y: number, entry: RemoteEntry): void {
  state.contextTarget = { entry };
  contextMenu.textContent = '';

  const destinationFolder = entry.type === 'directory' ? entry.path : dirName(entry.path);

  if (entry.type === 'file') {
    addContextItem('Open', () => {
      if (!state.selectedConnectionId) {
        return;
      }
      showToast(`Opening file: ${entry.name}`, 'success');
      postMessage({
        type: 'openRemoteFile',
        payload: {
          connectionId: state.selectedConnectionId,
          remotePath: entry.path
        }
      });
    });
  }

  addContextItem('Copy', () => {
    state.clipboard = { action: 'copy', entry };
    showToast(`Copied: ${entry.name}`, 'success');
  });

  addContextItem('Cut', () => {
    state.clipboard = { action: 'cut', entry };
    showToast(`Cut: ${entry.name}`, 'success');
  });

  addContextItem(
    'Paste',
    () => {
      applyClipboardPaste(destinationFolder);
    },
    !state.clipboard
  );

  addContextItem('New Folder', () => {
    createNewFolder(destinationFolder);
  });

  addContextItem('New File', () => {
    createNewFile(destinationFolder);
  });

  addContextItem('Rename', () => {
    renameEntry(entry);
  });

  addContextItem('Permission Change', () => {
    changePermissions(entry);
  });

  addContextItem('Delete', () => {
    deleteEntry(entry);
  });

  const maxLeft = Math.max(8, window.innerWidth - 220);
  const maxTop = Math.max(8, window.innerHeight - 280);
  contextMenu.style.left = `${Math.min(Math.max(8, x), maxLeft)}px`;
  contextMenu.style.top = `${Math.min(Math.max(8, y), maxTop)}px`;
  contextMenu.classList.remove('hidden');
}

function openDirectoryContextMenu(x: number, y: number, directoryPath: string): void {
  contextMenu.textContent = '';

  addContextItem(
    'Paste',
    () => {
      applyClipboardPaste(directoryPath);
    },
    !state.clipboard
  );

  addContextItem('New Folder', () => {
    createNewFolder(directoryPath);
  });

  addContextItem('New File', () => {
    createNewFile(directoryPath);
  });

  const maxLeft = Math.max(8, window.innerWidth - 220);
  const maxTop = Math.max(8, window.innerHeight - 280);
  contextMenu.style.left = `${Math.min(Math.max(8, x), maxLeft)}px`;
  contextMenu.style.top = `${Math.min(Math.max(8, y), maxTop)}px`;
  contextMenu.classList.remove('hidden');
}

function hideContextMenu(): void {
  contextMenu.classList.add('hidden');
  state.contextTarget = null;
}

function addContextItem(label: string, handler: () => void, disabled = false): void {
  const item = document.createElement('button');
  item.type = 'button';
  item.textContent = label;
  item.disabled = disabled;
  item.addEventListener('click', (event) => {
    event.stopPropagation();
    hideContextMenu();
    handler();
  });
  contextMenu.appendChild(item);
}

function toggleFolder(folderPath: string): void {
  if (state.expandedFolders.has(folderPath)) {
    state.expandedFolders.delete(folderPath);
    renderFileManager();
    return;
  }

  state.expandedFolders.add(folderPath);

  if (!state.directoryCache.has(folderPath)) {
    requestDirectory(folderPath);
  }

  renderFileManager();
}

function requestDirectory(directoryPath: string): void {
  if (!state.selectedConnectionId) {
    return;
  }

  const normalizedPath = normalizePath(directoryPath);
  if (state.pendingPaths.has(normalizedPath)) {
    return;
  }
  state.pendingPaths.add(normalizedPath);

  postMessage({
    type: 'listDirectory',
    payload: {
      connectionId: state.selectedConnectionId,
      path: normalizedPath
    }
  });
}

function navigateToPath(targetPath: string): void {
  if (!state.selectedConnectionId) {
    return;
  }

  const normalizedPath = normalizePath(targetPath);
  state.rootPath = normalizedPath;
  pathInput.value = normalizedPath;
  state.directoryCache.clear();
  state.expandedFolders.clear();
  requestDirectory(normalizedPath);
  renderFileManager();
}

function refreshCurrentRoot(): void {
  if (!state.selectedConnectionId) {
    return;
  }

  const root = normalizePath(state.rootPath);
  state.directoryCache.delete(root);
  requestDirectory(root);
}

function createNewFolder(parentPath: string): void {
  if (!state.selectedConnectionId) {
    showToast('Select a connection first.', 'error');
    return;
  }

  postMessage({
    type: 'createFolderInteractive',
    payload: {
      connectionId: state.selectedConnectionId,
      parentPath: normalizePath(parentPath)
    }
  });
}

function createNewFile(parentPath: string): void {
  if (!state.selectedConnectionId) {
    showToast('Select a connection first.', 'error');
    return;
  }

  postMessage({
    type: 'createFileInteractive',
    payload: {
      connectionId: state.selectedConnectionId,
      parentPath: normalizePath(parentPath)
    }
  });
}

function applyClipboardPaste(destinationFolder: string): void {
  if (!state.selectedConnectionId || !state.clipboard) {
    return;
  }

  const sourcePath = state.clipboard.entry.path;
  const destinationPath = joinPath(destinationFolder, baseName(sourcePath));

  if (state.clipboard.action === 'copy') {
    postMessage({
      type: 'copyPath',
      payload: {
        connectionId: state.selectedConnectionId,
        sourcePath,
        destinationPath,
        isDirectory: state.clipboard.entry.type === 'directory'
      }
    });
    return;
  }

  postMessage({
    type: 'movePath',
    payload: {
      connectionId: state.selectedConnectionId,
      sourcePath,
      destinationPath
    }
  });
  state.clipboard = null;
}

function renameEntry(entry: RemoteEntry): void {
  if (!state.selectedConnectionId) {
    return;
  }

  postMessage({
    type: 'renamePathInteractive',
    payload: {
      connectionId: state.selectedConnectionId,
      sourcePath: entry.path,
      currentName: baseName(entry.path)
    }
  });
}

function changePermissions(entry: RemoteEntry): void {
  if (!state.selectedConnectionId) {
    return;
  }

  postMessage({
    type: 'setPermissionsInteractive',
    payload: {
      connectionId: state.selectedConnectionId,
      remotePath: entry.path
    }
  });
}

function deleteEntry(entry: RemoteEntry): void {
  if (!state.selectedConnectionId) {
    return;
  }

  postMessage({
    type: 'deletePathInteractive',
    payload: {
      connectionId: state.selectedConnectionId,
      remotePath: entry.path,
      isDirectory: entry.type === 'directory',
      name: entry.name
    }
  });
}

function normalizePath(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) {
    return '/';
  }

  const normalized = trimmed.replace(/\\\\/g, '/');
  return normalized.startsWith('/') ? normalized : `/${normalized}`;
}

function sanitizeName(input: string): string {
  return input.replace(/[\\/]/g, '').trim();
}

function joinPath(parentPath: string, childName: string): string {
  const normalizedParent = normalizePath(parentPath).replace(/\/$/, '');
  const safeChild = sanitizeName(childName);
  return normalizedParent ? `${normalizedParent}/${safeChild}` : `/${safeChild}`;
}

function baseName(targetPath: string): string {
  const normalized = normalizePath(targetPath);
  const parts = normalized.split('/').filter((part) => part.length > 0);
  return parts.at(-1) ?? '';
}

function dirName(targetPath: string): string {
  const normalized = normalizePath(targetPath);
  const parts = normalized.split('/').filter((part) => part.length > 0);
  parts.pop();
  return parts.length === 0 ? '/' : `/${parts.join('/')}`;
}

function sortEntries(entries: RemoteEntry[]): RemoteEntry[] {
  return [...entries].sort((a, b) => {
    if (a.type !== b.type) {
      return a.type === 'directory' ? -1 : 1;
    }
    return entryNameCollator.compare(a.name, b.name);
  });
}

function getEntryIcon(entry: RemoteEntry): string {
  if (entry.type === 'directory') {
    return '📁';
  }

  const lowerName = entry.name.toLowerCase();
  if (lowerName.endsWith('.zip') || lowerName.endsWith('.tar') || lowerName.endsWith('.gz')) {
    return '🗜';
  }
  if (lowerName.endsWith('.json') || lowerName.endsWith('.yaml') || lowerName.endsWith('.yml')) {
    return '🧩';
  }
  if (lowerName.endsWith('.ts') || lowerName.endsWith('.js') || lowerName.endsWith('.tsx') || lowerName.endsWith('.jsx')) {
    return '⌘';
  }
  if (lowerName.endsWith('.md') || lowerName.endsWith('.txt')) {
    return '📄';
  }
  if (lowerName.endsWith('.png') || lowerName.endsWith('.jpg') || lowerName.endsWith('.jpeg') || lowerName.endsWith('.svg')) {
    return '🖼';
  }

  return '📄';
}

function createActionButton(label: string, onClick: () => void): HTMLButtonElement {
  const button = document.createElement('button');
  button.className = 'btn btn-ghost';
  button.textContent = label;
  button.addEventListener('click', (event) => {
    event.stopPropagation();
    onClick();
  });
  return button;
}

function showToast(message: string, type: 'success' | 'error'): void {
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.textContent = message;
  toastRoot.appendChild(toast);

  window.setTimeout(() => {
    toast.remove();
  }, 3_000);
}

function postMessage(message: WebviewRequestMessage): void {
  vscode.postMessage(message);
}

function getElement<TElement extends HTMLElement>(id: string): TElement {
  const element = document.getElementById(id);
  if (!element) {
    throw new Error(`Element not found: ${id}`);
  }

  return element as TElement;
}

initialize();
