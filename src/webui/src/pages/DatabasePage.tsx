import { useState } from 'react'
import { useConfig } from '../hooks/useConfig'
import { postJson } from '../utils/api'
import { Button, ErrorNotice, Field, Input, Loading, NumberInput, Panel, Select, Toggle } from '../components/ui'

export default function DatabasePage() {
    const { config, setConfig, saving, error, notice, save } = useConfig()
    const [testing, setTesting] = useState(false)
    const [testResult, setTestResult] = useState('')
    if (!config) return <><ErrorNotice message={error} /><Loading label="正在读取数据库配置" /></>
    const database = config.database
    const patch = (value: Partial<typeof database>) => setConfig({ ...config, database: { ...database, ...value } })
    const test = async () => {
        setTesting(true); setTestResult('')
        try { await postJson('/database/test', database); setTestResult('连接成功') }
        catch (reason) { setTestResult(reason instanceof Error ? reason.message : '连接失败') }
        finally { setTesting(false) }
    }
    return <div className="page-stack narrow-page">
        <ErrorNotice message={error} />{notice && <div className="notice">{notice}</div>}{testResult && <div className="notice">{testResult}</div>}
        <Panel title="业务数据库" description="同一时间只使用一个后端，不会自动切换或隐式同步数据。">
            <Field label="数据库协议"><Select value={database.driver} onChange={(e) => patch({ driver: e.target.value as typeof database.driver })}><option value="sqlite">SQLite（本地默认）</option><option value="postgres">PostgreSQL</option><option value="mysql">MySQL</option></Select></Field>
            {database.driver === 'sqlite' ? <Field label="SQLite 文件名" hint="相对路径保存在插件数据目录中。" wide><Input value={database.sqliteFile} onChange={(e) => patch({ sqliteFile: e.target.value })} /></Field> : <>
                <Field label="连接串" hint="密码不会通过读取接口返回明文。" wide><Input type="password" value={database.connectionString} onChange={(e) => patch({ connectionString: e.target.value })} autoComplete="new-password" /></Field>
                <Toggle checked={database.tls} onChange={(tls) => patch({ tls })} label="使用 TLS 连接" />
            </>}
            <Field label="连接池大小"><NumberInput min="1" max="100" value={database.poolSize} onChange={(e) => patch({ poolSize: Number(e.target.value) })} /></Field>
        </Panel>
        <Panel title="切换提醒" description="连接测试不会创建表。保存后需要重载插件才会应用新后端。">
            <p className="muted">切换到空数据库不会自动带走旧数据。请先导出，再在新后端导入。数据库不可用时插件会停止模型与工具处理，而不是退回 SQLite。</p>
        </Panel>
        <div className="sticky-save"><Button disabled={testing} onClick={() => void test()}>{testing ? '正在测试' : '测试连接'}</Button><Button variant="primary" disabled={saving} onClick={() => void save()}>保存数据库配置</Button></div>
    </div>
}
