import { useEffect, useState } from 'react'
import { useResource } from '../hooks/useResource'
import { apiData, postJson } from '../utils/api'
import type {
    AccessControlState,
    AccessList,
    AccessListMember,
    AccessListType,
    AccessMode,
    AccessPolicySnapshot,
    AccessSubjectType,
    NapCatContact,
} from '../types'
import {
    Badge,
    Button,
    ErrorNotice,
    Field,
    Input,
    Loading,
    Panel,
    Select,
} from '../components/ui'

interface AccessControlData {
    state: AccessControlState
    snapshot: AccessPolicySnapshot
    lists: AccessList[]
}

interface ListDetailData {
    list: AccessList
    members: AccessListMember[]
}

interface ContactsData {
    groups: NapCatContact[]
    friends: NapCatContact[]
}

export default function AccessControlPage() {
    const { data, loading, error, refresh } = useResource<AccessControlData>('/access-control')
    const [selectedListId, setSelectedListId] = useState<string | null>(null)
    const [listDetail, setListDetail] = useState<ListDetailData | null>(null)
    const [loadingDetail, setLoadingDetail] = useState(false)
    const [notice, setNotice] = useState('')
    const [errorMsg, setErrorMsg] = useState('')

    // Mode & Active list editing
    const [editMode, setEditMode] = useState<AccessMode>('whitelist')
    const [editActiveBlacklist, setEditActiveBlacklist] = useState<string | null>(null)
    const [editActiveWhitelist, setEditActiveWhitelist] = useState<string | null>(null)
    const [savingMode, setSavingMode] = useState(false)

    // List tab in manager
    const [listTab, setListTab] = useState<AccessListType>('whitelist')

    // New list creation
    const [showCreate, setShowCreate] = useState(false)
    const [createType, setCreateType] = useState<AccessListType>('whitelist')
    const [createName, setCreateName] = useState('')
    const [createDesc, setCreateDesc] = useState('')

    // Manual member add
    const [manualType, setManualType] = useState<AccessSubjectType>('user')
    const [manualId, setManualId] = useState('')
    const [manualNote, setManualNote] = useState('')

    // Contacts
    const [contacts, setContacts] = useState<ContactsData | null>(null)
    const [loadingContacts, setLoadingContacts] = useState(false)
    const [contactSearch, setContactSearch] = useState('')
    const [contactFilter, setContactFilter] = useState<'all' | 'group' | 'user'>('all')
    const [selectedContactIds, setSelectedContactIds] = useState<Set<string>>(new Set())

    useEffect(() => {
        if (data?.state) {
            setEditMode(data.state.mode)
            setEditActiveBlacklist(data.state.activeBlacklistId)
            setEditActiveWhitelist(data.state.activeWhitelistId)
            setListTab(data.state.mode)
            if (!selectedListId && data.lists.length > 0) {
                const defaultSelect = data.state.mode === 'whitelist'
                    ? (data.state.activeWhitelistId || data.lists.find((l) => l.type === 'whitelist')?.id)
                    : (data.state.activeBlacklistId || data.lists.find((l) => l.type === 'blacklist')?.id)
                setSelectedListId(defaultSelect || data.lists[0]?.id || null)
            }
        }
    }, [data])

    // Load list details
    const loadListDetail = async (id: string) => {
        setLoadingDetail(true)
        try {
            const res = await apiData<ListDetailData>(`/access-control/lists/${id}`)
            setListDetail(res)
        } catch (err) {
            setErrorMsg(err instanceof Error ? err.message : '加载名单详情失败')
        } finally {
            setLoadingDetail(false)
        }
    }

    useEffect(() => {
        if (selectedListId) {
            void loadListDetail(selectedListId)
        } else {
            setListDetail(null)
        }
    }, [selectedListId])

    // Load contacts
    const fetchContacts = async (forceRefresh = false) => {
        setLoadingContacts(true)
        try {
            const res = await apiData<ContactsData>(`/access-control/contacts?refresh=${forceRefresh ? 'true' : 'false'}`)
            setContacts(res)
        } catch {
            // Contacts fetch failure is soft; manual input always available
        } finally {
            setLoadingContacts(false)
        }
    }

    useEffect(() => {
        void fetchContacts(false)
    }, [])

    const handleSaveMode = async () => {
        setSavingMode(true)
        setErrorMsg('')
        setNotice('')
        try {
            await postJson('/access-control/mode', {
                mode: editMode,
                activeBlacklistId: editActiveBlacklist,
                activeWhitelistId: editActiveWhitelist,
            })
            setNotice('运行模式与生效名单已更新')
            await refresh()
        } catch (err) {
            setErrorMsg(err instanceof Error ? err.message : '更新运行模式失败')
        } finally {
            setSavingMode(false)
        }
    }

    const handleSetActive = async (list: AccessList) => {
        setErrorMsg('')
        setNotice('')
        try {
            if (list.type === 'whitelist') {
                setEditActiveWhitelist(list.id)
                await postJson('/access-control/mode', {
                    mode: editMode,
                    activeBlacklistId: editActiveBlacklist,
                    activeWhitelistId: list.id,
                })
            } else {
                setEditActiveBlacklist(list.id)
                await postJson('/access-control/mode', {
                    mode: editMode,
                    activeBlacklistId: list.id,
                    activeWhitelistId: editActiveWhitelist,
                })
            }
            setNotice(`已将“${list.name}”设为当前生效${list.type === 'whitelist' ? '白名单' : '黑名单'}`)
            await refresh()
        } catch (err) {
            setErrorMsg(err instanceof Error ? err.message : '设置生效名单失败')
        }
    }

    const handleCreateList = async () => {
        if (!createName.trim()) return
        setErrorMsg('')
        setNotice('')
        try {
            const created = await postJson<AccessList>('/access-control/lists', {
                type: createType,
                name: createName.trim(),
                description: createDesc.trim(),
            })
            setNotice(`已创建${created.type === 'blacklist' ? '黑名单' : '白名单'}：${created.name}`)
            setCreateName('')
            setCreateDesc('')
            setShowCreate(false)
            await refresh()
            setSelectedListId(created.id)
            setListTab(created.type)
        } catch (err) {
            setErrorMsg(err instanceof Error ? err.message : '创建名单失败')
        }
    }

    const handleDeleteList = async (list: AccessList) => {
        if (list.isDefault) {
            alert('系统默认名单不可删除。您可以清空其成员或重命名。')
            return
        }

        const isActive = (list.type === 'blacklist' && data?.state.activeBlacklistId === list.id)
            || (list.type === 'whitelist' && data?.state.activeWhitelistId === list.id)

        let msg = `确定删除名单“${list.name}”？`
        if (isActive && list.type === 'whitelist' && data?.state.mode === 'whitelist') {
            msg += '\n\n【重要警告】这是当前生效的白名单！删除后将没有生效白名单，白名单模式下将默认禁用所有消息！'
        } else if (isActive) {
            msg += '\n\n这是当前生效的名单，删除后生效名单将变为未选择。'
        }

        if (!confirm(msg)) return

        try {
            await postJson(`/access-control/lists/${list.id}/delete`, {})
            setNotice(`已删除名单：${list.name}`)
            if (selectedListId === list.id) {
                setSelectedListId(null)
            }
            await refresh()
        } catch (err) {
            setErrorMsg(err instanceof Error ? err.message : '删除名单失败')
        }
    }

    const handleDuplicateList = async (list: AccessList) => {
        const newName = prompt(`请输入新名单名称：`, `${list.name} (副本)`)
        if (!newName || !newName.trim()) return
        try {
            const dup = await postJson<AccessList>(`/access-control/lists/${list.id}/duplicate`, { name: newName.trim() })
            setNotice(`已复制名单：${dup.name}`)
            await refresh()
            setSelectedListId(dup.id)
        } catch (err) {
            setErrorMsg(err instanceof Error ? err.message : '复制名单失败')
        }
    }

    const handleManualAddMember = async () => {
        if (!selectedListId || !manualId.trim()) return
        setErrorMsg('')
        setNotice('')
        try {
            const res = await postJson<{ added: number; skipped: number }>(`/access-control/lists/${selectedListId}/members`, {
                members: [{
                    subjectType: manualType,
                    subjectId: manualId.trim(),
                    note: manualNote.trim(),
                }],
            })
            if (res.added > 0) {
                setNotice(`已添加 ${res.added} 个成员`)
                setManualId('')
                setManualNote('')
                await loadListDetail(selectedListId)
                await refresh()
            } else {
                setNotice('成员已在名单中或格式有误，未重复添加')
            }
        } catch (err) {
            setErrorMsg(err instanceof Error ? err.message : '添加成员失败')
        }
    }

    const handleRemoveMember = async (member: AccessListMember) => {
        if (!selectedListId) return
        try {
            await postJson(`/access-control/lists/${selectedListId}/members/remove`, {
                subjectType: member.subjectType,
                subjectId: member.subjectId,
            })
            setNotice(`已移除：${member.subjectId}`)
            await loadListDetail(selectedListId)
            await refresh()
        } catch (err) {
            setErrorMsg(err instanceof Error ? err.message : '移除成员失败')
        }
    }

    const handleBatchAddContacts = async () => {
        if (!selectedListId || selectedContactIds.size === 0 || !contacts) return
        setErrorMsg('')
        setNotice('')
        const allContacts = [...contacts.groups, ...contacts.friends]
        const toAdd: Array<{ subjectType: AccessSubjectType; subjectId: string; note: string }> = []
        for (const cid of selectedContactIds) {
            const found = allContacts.find((c) => `${c.type}:${c.id}` === cid)
            if (found) {
                toAdd.push({
                    subjectType: found.type,
                    subjectId: found.id,
                    note: found.remark ? `${found.name} (${found.remark})` : found.name,
                })
            }
        }
        if (!toAdd.length) return
        try {
            const res = await postJson<{ added: number; skipped: number }>(`/access-control/lists/${selectedListId}/members`, {
                members: toAdd,
            })
            setNotice(`批量添加完成：成功新增 ${res.added} 个，跳过/重复 ${res.skipped} 个`)
            setSelectedContactIds(new Set())
            await loadListDetail(selectedListId)
            await refresh()
        } catch (err) {
            setErrorMsg(err instanceof Error ? err.message : '批量添加失败')
        }
    }

    if (loading && !data) return <Loading label="正在加载访问控制配置..." />

    const allLists = data?.lists ?? []
    const blacklists = allLists.filter((l) => l.type === 'blacklist')
    const whitelists = allLists.filter((l) => l.type === 'whitelist')
    const currentTabLists = listTab === 'whitelist' ? whitelists : blacklists

    // Filter contacts for picker
    const allContactsList = [
        ...(contacts?.groups || []),
        ...(contacts?.friends || []),
    ]
    const filteredContacts = allContactsList.filter((c) => {
        if (contactFilter !== 'all' && c.type !== contactFilter) return false
        if (!contactSearch.trim()) return true
        const q = contactSearch.trim().toLowerCase()
        return c.id.includes(q) || c.name.toLowerCase().includes(q) || (c.remark && c.remark.toLowerCase().includes(q))
    })

    return (
        <div className="page-stack">
            <ErrorNotice message={error || errorMsg} />
            {notice && <div className="notice">{notice}</div>}

            {/* Top Card: Running Mode & Active List (Hierarchical & Symmetric) */}
            <Panel
                title="运行模式与生效名单"
                description="第一级由运行模式决定当前机制；第二级决定使用哪份名单。白名单与黑名单各自独立记录生效名单，切换模式互不干扰。"
            >
                <div className="form-grid">
                    <Field label="当前运行模式" hint="白名单模式下未配置名单默认全部禁用；黑名单模式下未配置名单默认全部放行。">
                        <Select
                            value={editMode}
                            onChange={(e) => {
                                const newMode = e.target.value as AccessMode
                                setEditMode(newMode)
                                setListTab(newMode)
                            }}
                        >
                            <option value="whitelist">白名单模式（默认全部禁用，仅允许名单内成员）</option>
                            <option value="blacklist">黑名单模式（默认全部放行，拦截名单内成员）</option>
                        </Select>
                    </Field>

                    {editMode === 'whitelist' ? (
                        <Field
                            label="当前生效白名单"
                            hint="此名单中的群聊允许整群使用；用户条目用于私聊放行。"
                        >
                            <Select
                                value={editActiveWhitelist || ''}
                                onChange={(e) => setEditActiveWhitelist(e.target.value || null)}
                            >
                                <option value="">（未选择 - 默认全部禁用）</option>
                                {whitelists.map((l) => (
                                    <option key={l.id} value={l.id}>
                                        {l.name} {l.isDefault ? '(默认名单)' : ''}
                                    </option>
                                ))}
                            </Select>
                        </Field>
                    ) : (
                        <Field
                            label="当前生效黑名单"
                            hint="此名单中的群聊整群拦截；用户条目在群聊和私聊中均被拦截。"
                        >
                            <Select
                                value={editActiveBlacklist || ''}
                                onChange={(e) => setEditActiveBlacklist(e.target.value || null)}
                            >
                                <option value="">（未选择 - 默认全部允许）</option>
                                {blacklists.map((l) => (
                                    <option key={l.id} value={l.id}>
                                        {l.name} {l.isDefault ? '(默认名单)' : ''}
                                    </option>
                                ))}
                            </Select>
                        </Field>
                    )}
                </div>

                <div className="button-row">
                    <Button variant="primary" disabled={savingMode} onClick={() => void handleSaveMode()}>
                        {savingMode ? '正在应用' : '应用生效设置'}
                    </Button>
                </div>
            </Panel>

            {/* List Management & Detail */}
            <div className="editor-layout">
                {/* Left: Lists sidebar */}
                <Panel
                    title="名单库"
                    description="系统内置默认白名单与黑名单。您可以创建多套名单，按需切换当前生效名单。"
                    actions={
                        <Button
                            variant="primary"
                            onClick={() => {
                                setCreateType(listTab)
                                setShowCreate(true)
                            }}
                        >
                            新建名单
                        </Button>
                    }
                >
                    {/* Tab Switcher for Lists */}
                    <div className="flex border-b border-line mb-3">
                        <button
                            type="button"
                            className={`flex-1 py-2 text-xs font-semibold border-b-2 transition-colors cursor-pointer ${
                                listTab === 'whitelist'
                                    ? 'border-accent text-accent'
                                    : 'border-transparent text-muted hover:text-ink'
                            }`}
                            onClick={() => setListTab('whitelist')}
                        >
                            白名单列表 ({whitelists.length})
                        </button>
                        <button
                            type="button"
                            className={`flex-1 py-2 text-xs font-semibold border-b-2 transition-colors cursor-pointer ${
                                listTab === 'blacklist'
                                    ? 'border-accent text-accent'
                                    : 'border-transparent text-muted hover:text-ink'
                            }`}
                            onClick={() => setListTab('blacklist')}
                        >
                            黑名单列表 ({blacklists.length})
                        </button>
                    </div>

                    {showCreate && (
                        <div className="panel p-3 mb-3 bg-surface-subtle">
                            <h4 className="text-sm font-semibold mb-2">新建{createType === 'whitelist' ? '白名单' : '黑名单'}</h4>
                            <div className="form-grid">
                                <Field label="类型">
                                    <Select value={createType} onChange={(e) => setCreateType(e.target.value as AccessListType)}>
                                        <option value="whitelist">白名单</option>
                                        <option value="blacklist">黑名单</option>
                                    </Select>
                                </Field>
                                <Field label="名单名称">
                                    <Input value={createName} placeholder="例如：日常交流群" onChange={(e) => setCreateName(e.target.value)} />
                                </Field>
                            </div>
                            <Field label="描述 (选填)" wide>
                                <Input value={createDesc} placeholder="可选描述备注" onChange={(e) => setCreateDesc(e.target.value)} />
                            </Field>
                            <div className="button-row">
                                <Button variant="primary" onClick={() => void handleCreateList()}>创建</Button>
                                <Button onClick={() => setShowCreate(false)}>取消</Button>
                            </div>
                        </div>
                    )}

                    <div className="resource-list">
                        {currentTabLists.map((l) => {
                            const isActive = l.type === 'whitelist'
                                ? data?.state.activeWhitelistId === l.id
                                : data?.state.activeBlacklistId === l.id
                            return (
                                <button
                                    key={l.id}
                                    className={`resource-row ${selectedListId === l.id ? 'selected' : ''}`}
                                    onClick={() => setSelectedListId(l.id)}
                                >
                                    <span>
                                        <strong>{l.name}</strong>
                                        <small>{l.description || '无描述'}</small>
                                    </span>
                                    <div className="flex items-center gap-1">
                                        {l.isDefault && <Badge tone="neutral">默认</Badge>}
                                        {isActive && <Badge tone={l.type === 'whitelist' ? 'good' : 'warn'}>生效中</Badge>}
                                    </div>
                                </button>
                            )
                        })}
                        {currentTabLists.length === 0 && (
                            <p className="muted text-xs px-2 py-4 text-center">暂无{listTab === 'whitelist' ? '白名单' : '黑名单'}</p>
                        )}
                    </div>
                </Panel>

                {/* Right: Selected List Members & Add Form */}
                {selectedListId && listDetail ? (
                    <div className="page-stack">
                        <Panel
                            title={`${listDetail.list.name} (${listDetail.list.type === 'whitelist' ? '白名单' : '黑名单'})`}
                            description={listDetail.list.description || '管理名单内的用户与群聊条目。白名单中的群聊允许整群使用，用户白名单控制私聊权限。'}
                            actions={
                                <div className="button-row" style={{ margin: 0 }}>
                                    <Button onClick={() => void handleSetActive(listDetail.list)}>
                                        设为当前生效名单
                                    </Button>
                                    <Button onClick={() => void handleDuplicateList(listDetail.list)}>复制副本</Button>
                                    {listDetail.list.isDefault ? (
                                        <Badge tone="neutral">系统默认名单不可删除</Badge>
                                    ) : (
                                        <Button variant="danger" onClick={() => void handleDeleteList(listDetail.list)}>删除此名单</Button>
                                    )}
                                </div>
                            }
                        >
                            {/* Member addition section */}
                            <div className="two-column">
                                {/* From Contacts */}
                                <div className="panel p-3">
                                    <div className="flex justify-between items-center mb-2">
                                        <h4 className="text-sm font-semibold">从联系人快速添加</h4>
                                        <Button
                                            disabled={loadingContacts}
                                            onClick={() => void fetchContacts(true)}
                                        >
                                            {loadingContacts ? '刷新中' : '刷新联系人'}
                                        </Button>
                                    </div>
                                    <div className="flex gap-2 mb-2">
                                        <Input
                                            value={contactSearch}
                                            placeholder="搜索好友或群聊..."
                                            onChange={(e) => setContactSearch(e.target.value)}
                                        />
                                        <Select
                                            value={contactFilter}
                                            style={{ width: '100px' }}
                                            onChange={(e) => setContactFilter(e.target.value as any)}
                                        >
                                            <option value="all">全部</option>
                                            <option value="group">群聊</option>
                                            <option value="user">好友</option>
                                        </Select>
                                    </div>

                                    <div className="flex justify-between items-center mb-1.5 px-1 text-xs text-muted">
                                        <span>匹配到 {filteredContacts.length} 个联系人</span>
                                        {filteredContacts.length > 0 && (
                                            <button
                                                type="button"
                                                className="text-accent hover:underline cursor-pointer"
                                                onClick={() => {
                                                    const allIds = filteredContacts.map((c) => `${c.type}:${c.id}`)
                                                    const isAll = allIds.every((id) => selectedContactIds.has(id))
                                                    const next = new Set(selectedContactIds)
                                                    if (isAll) {
                                                        for (const id of allIds) next.delete(id)
                                                    } else {
                                                        for (const id of allIds) next.add(id)
                                                    }
                                                    setSelectedContactIds(next)
                                                }}
                                            >
                                                {filteredContacts.every((c) => selectedContactIds.has(`${c.type}:${c.id}`))
                                                    ? '取消全选'
                                                    : '全选当页'}
                                            </button>
                                        )}
                                    </div>

                                    <div style={{ maxHeight: '200px', overflowY: 'auto' }} className="border border-line rounded p-1 mb-2">
                                        {filteredContacts.map((c) => {
                                            const cid = `${c.type}:${c.id}`
                                            const checked = selectedContactIds.has(cid)
                                            return (
                                                <label key={cid} className="flex items-center gap-2 p-1 hover:bg-surface-subtle cursor-pointer text-xs">
                                                    <input
                                                        type="checkbox"
                                                        checked={checked}
                                                        onChange={(e) => {
                                                            const next = new Set(selectedContactIds)
                                                            if (e.target.checked) next.add(cid)
                                                            else next.delete(cid)
                                                            setSelectedContactIds(next)
                                                        }}
                                                    />
                                                    <Badge tone={c.type === 'group' ? 'neutral' : 'warn'}>
                                                        {c.type === 'group' ? '群' : '好友'}
                                                    </Badge>
                                                    <span className="truncate flex-1">
                                                        {c.name} {c.remark ? `(${c.remark})` : ''} ({c.id})
                                                    </span>
                                                </label>
                                            )
                                        })}
                                        {filteredContacts.length === 0 && (
                                            <p className="text-xs text-muted p-2">未找到匹配的群聊或好友</p>
                                        )}
                                    </div>

                                    <Button
                                        variant="primary"
                                        disabled={selectedContactIds.size === 0}
                                        onClick={() => void handleBatchAddContacts()}
                                    >
                                        批量添加所选 ({selectedContactIds.size})
                                    </Button>
                                </div>

                                {/* Manual Input */}
                                <div className="panel p-3">
                                    <h4 className="text-sm font-semibold mb-2">手动输入添加</h4>
                                    <Field label="类型">
                                        <Select value={manualType} onChange={(e) => setManualType(e.target.value as AccessSubjectType)}>
                                            <option value="user">用户 QQ 号</option>
                                            <option value="group">群号</option>
                                        </Select>
                                    </Field>
                                    <Field label="QQ 号 / 群号" hint="支持手动添加非好友 QQ 或临时群号。">
                                        <Input
                                            value={manualId}
                                            placeholder="1-64 位数字"
                                            onChange={(e) => setManualId(e.target.value.replace(/\D/g, ''))}
                                        />
                                    </Field>
                                    <Field label="备注 (选填)">
                                        <Input
                                            value={manualNote}
                                            placeholder="备注说明"
                                            onChange={(e) => setManualNote(e.target.value)}
                                        />
                                    </Field>
                                    <Button variant="primary" onClick={() => void handleManualAddMember()}>
                                        添加到名单
                                    </Button>
                                </div>
                            </div>

                            {/* Current Members List */}
                            <div className="mt-4">
                                <h4 className="text-sm font-semibold mb-2">名单成员 ({listDetail.members.length})</h4>
                                {loadingDetail ? (
                                    <Loading label="加载成员中..." />
                                ) : (
                                    <div className="resource-list" style={{ maxHeight: '400px' }}>
                                        {listDetail.members.map((m) => (
                                            <div key={m.id} className="resource-row">
                                                <span>
                                                    <strong>
                                                        {m.subjectId} {m.note ? `(${m.note})` : ''}
                                                    </strong>
                                                    <small>{new Date(m.createdAt).toLocaleString()}</small>
                                                </span>
                                                <Badge tone={m.subjectType === 'group' ? 'neutral' : 'warn'}>
                                                    {m.subjectType === 'group' ? '群聊' : '用户'}
                                                </Badge>
                                                <Button variant="danger" onClick={() => void handleRemoveMember(m)}>
                                                    移除
                                                </Button>
                                            </div>
                                        ))}
                                        {listDetail.members.length === 0 && (
                                            <p className="muted text-xs p-3">此名单当前没有任何成员。</p>
                                        )}
                                    </div>
                                )}
                            </div>
                        </Panel>
                    </div>
                ) : (
                    <Panel>
                        <p className="muted">请在左侧选择或新建一个名单以查看和管理其成员。</p>
                    </Panel>
                )}
            </div>
        </div>
    )
}
