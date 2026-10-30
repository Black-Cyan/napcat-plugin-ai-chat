import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import {
    Kysely,
    PostgresDialect,
    SqliteDialect,
    MysqlDialect,
    sql,
    type Dialect,
} from 'kysely';
import { Pool as PostgresPool } from 'pg';
import { createPool as createMysqlPool } from 'mysql2/promise';
import type { DatabaseConfig } from '../types';
import type { DatabaseSchema } from './schema';

export class Database {
    constructor(readonly db: Kysely<DatabaseSchema>, readonly driver: DatabaseConfig['driver']) {}

    async setMetadata(key: string, value: string): Promise<void> {
        const values = { key, value };
        if (this.driver === 'mysql') {
            await this.db.insertInto('app_metadata').values(values)
                .onConflict((conflict) => conflict.doUpdateSet({ value })).execute();
        } else {
            await this.db.insertInto('app_metadata').values(values)
                .onConflict((conflict) => conflict.column('key').doUpdateSet({ value })).execute();
        }
    }

    async getMetadata(key: string): Promise<string | null> {
        const row = await this.db.selectFrom('app_metadata').select('value').where('key', '=', key).executeTakeFirst();
        return row?.value ?? null;
    }

    async migrate(): Promise<void> {
        await this.db.schema.createTable('app_metadata').ifNotExists()
            .addColumn('key', 'varchar(128)', (column) => column.primaryKey())
            .addColumn('value', 'text', (column) => column.notNull())
            .execute();
        const current = await this.getMetadata('schema_version');
        const version = Number(current ?? 0);
        if (version < 1) await this.migrateV1();
        if (version < 2) await this.migrateV2();
        if (version < 3) await this.migrateV3(version);
        if (version < 4) await this.migrateV4();
        await this.setMetadata('schema_version', '4');
    }

    private async migrateV4(): Promise<void> {
        // Preferred forms of address are derived per user and editable in the WebUI.
        for (const column of ['address', 'address_manual']) {
            try {
                await this.db.schema.alterTable('user_profiles').addColumn(column, column === 'address' ? 'text' : 'integer', (c) => column === 'address' ? c.notNull().defaultTo('') : c.notNull().defaultTo(0)).execute();
            } catch (error) {
                if (!/duplicate column|already exists|1060/i.test(String(error))) throw error;
            }
        }
    }

    private async migrateV3(fromVersion: number): Promise<void> {
        const schema = this.db.schema;
        await schema.createTable('access_lists').ifNotExists()
            .addColumn('id', 'varchar(64)', (c) => c.primaryKey())
            .addColumn('type', 'varchar(16)', (c) => c.notNull())
            .addColumn('name', 'text', (c) => c.notNull())
            .addColumn('description', 'text', (c) => c.notNull())
            .addColumn('is_default', 'integer', (c) => c.notNull().defaultTo(0))
            .addColumn('created_at', 'bigint', (c) => c.notNull())
            .addColumn('updated_at', 'bigint', (c) => c.notNull())
            .execute();

        await schema.createTable('access_list_members').ifNotExists()
            .addColumn('id', 'varchar(64)', (c) => c.primaryKey())
            .addColumn('list_id', 'varchar(64)', (c) => c.notNull().references('access_lists.id').onDelete('cascade'))
            .addColumn('subject_type', 'varchar(16)', (c) => c.notNull())
            .addColumn('subject_id', 'varchar(64)', (c) => c.notNull())
            .addColumn('note', 'text', (c) => c.notNull())
            .addColumn('created_at', 'bigint', (c) => c.notNull())
            .execute();

        await this.createIndex('access_list_members_list_idx', 'access_list_members', ['list_id']);
        await this.createIndex('access_list_members_subject_idx', 'access_list_members', ['subject_type', 'subject_id']);

        const now = Date.now();

        // Ensure default blacklist exists
        const existingBlacklist = await this.db.selectFrom('access_lists')
            .selectAll()
            .where('type', '=', 'blacklist')
            .where('is_default', '=', 1)
            .executeTakeFirst();
        let defaultBlacklistId = existingBlacklist?.id;
        if (!defaultBlacklistId) {
            defaultBlacklistId = randomUUID();
            await this.db.insertInto('access_lists').values({
                id: defaultBlacklistId,
                type: 'blacklist',
                name: '默认黑名单',
                description: '系统内置的默认黑名单',
                is_default: 1,
                created_at: now,
                updated_at: now,
            }).execute();
        }

        // Ensure default whitelist exists
        const existingWhitelist = await this.db.selectFrom('access_lists')
            .selectAll()
            .where('type', '=', 'whitelist')
            .where('is_default', '=', 1)
            .executeTakeFirst();
        let defaultWhitelistId = existingWhitelist?.id;
        if (!defaultWhitelistId) {
            defaultWhitelistId = randomUUID();
            await this.db.insertInto('access_lists').values({
                id: defaultWhitelistId,
                type: 'whitelist',
                name: '默认白名单',
                description: '系统内置的默认白名单',
                is_default: 1,
                created_at: now,
                updated_at: now,
            }).execute();
        }

        if (fromVersion === 0) {
            await this.setMetadata('access_mode', 'whitelist');
            await this.setMetadata('active_blacklist_id', defaultBlacklistId);
            await this.setMetadata('active_whitelist_id', defaultWhitelistId);
        } else {
            const existingMode = await this.getMetadata('access_mode');
            if (!existingMode) {
                await this.setMetadata('access_mode', 'blacklist');
                try {
                    const oldEntries = await this.db.selectFrom('blacklist_entries').selectAll().execute();
                    for (const entry of oldEntries) {
                        await this.db.insertInto('access_list_members').values({
                            id: randomUUID(),
                            list_id: defaultBlacklistId,
                            subject_type: entry.subject_type,
                            subject_id: entry.subject_id,
                            note: '',
                            created_at: Number(entry.created_at) || now,
                        }).onConflict((conflict) => conflict.doNothing()).execute();
                    }
                } catch {
                    // ignore if table doesn't exist
                }
                await this.setMetadata('active_blacklist_id', defaultBlacklistId);
                await this.setMetadata('active_whitelist_id', defaultWhitelistId);
            }
        }
    }

    private async migrateV1(): Promise<void> {
        const schema = this.db.schema;
        await schema.createTable('conversations').ifNotExists()
            .addColumn('id', 'varchar(64)', (c) => c.primaryKey())
            .addColumn('type', 'varchar(16)', (c) => c.notNull())
            .addColumn('target_id', 'varchar(64)', (c) => c.notNull())
            .addColumn('title', 'text', (c) => c.notNull())
            .addColumn('next_seq', 'integer', (c) => c.notNull().defaultTo(1))
            .addColumn('config_json', 'text', (c) => c.notNull())
            .addColumn('prompt_profile_id', 'varchar(64)')
            .addColumn('provider_profile_id', 'varchar(64)')
            .addColumn('bot_rounds', 'integer', (c) => c.notNull().defaultTo(0))
            .addColumn('created_at', 'bigint', (c) => c.notNull())
            .addColumn('updated_at', 'bigint', (c) => c.notNull())
            .addUniqueConstraint('conversations_target_unique', ['type', 'target_id']).execute();

        await schema.createTable('message_batches').ifNotExists()
            .addColumn('id', 'varchar(64)', (c) => c.primaryKey())
            .addColumn('conversation_id', 'varchar(64)', (c) => c.notNull().references('conversations.id').onDelete('cascade'))
            .addColumn('status', 'varchar(16)', (c) => c.notNull())
            .addColumn('start_seq', 'integer', (c) => c.notNull())
            .addColumn('end_seq', 'integer', (c) => c.notNull())
            .addColumn('message_count', 'integer', (c) => c.notNull())
            .addColumn('first_message_at', 'bigint', (c) => c.notNull())
            .addColumn('last_message_at', 'bigint', (c) => c.notNull())
            .addColumn('attempts', 'integer', (c) => c.notNull().defaultTo(0))
            .addColumn('error', 'text').execute();

        await schema.createTable('messages').ifNotExists()
            .addColumn('id', 'varchar(64)', (c) => c.primaryKey())
            .addColumn('conversation_id', 'varchar(64)', (c) => c.notNull().references('conversations.id').onDelete('cascade'))
            .addColumn('seq', 'integer', (c) => c.notNull())
            .addColumn('batch_id', 'varchar(64)', (c) => c.references('message_batches.id').onDelete('set null'))
            .addColumn('napcat_message_id', 'varchar(128)')
            .addColumn('sender_id', 'varchar(64)')
            .addColumn('sender_name', 'text', (c) => c.notNull())
            .addColumn('sender_kind', 'varchar(16)', (c) => c.notNull())
            .addColumn('role', 'varchar(16)', (c) => c.notNull())
            .addColumn('content_json', 'text', (c) => c.notNull())
            .addColumn('raw_event_json', 'text', (c) => c.notNull())
            .addColumn('occurred_at', 'bigint', (c) => c.notNull())
            .addColumn('received_at', 'bigint', (c) => c.notNull())
            .addUniqueConstraint('messages_conversation_seq_unique', ['conversation_id', 'seq']).execute();

        await schema.createTable('conversation_summaries').ifNotExists()
            .addColumn('conversation_id', 'varchar(64)', (c) => c.primaryKey().references('conversations.id').onDelete('cascade'))
            .addColumn('content', 'text', (c) => c.notNull())
            .addColumn('covered_through_seq', 'integer', (c) => c.notNull().defaultTo(0))
            .addColumn('updated_at', 'bigint', (c) => c.notNull()).execute();

        await schema.createTable('prompt_profiles').ifNotExists()
            .addColumn('id', 'varchar(64)', (c) => c.primaryKey())
            .addColumn('name', 'text', (c) => c.notNull())
            .addColumn('content', 'text', (c) => c.notNull())
            .addColumn('is_default', 'integer', (c) => c.notNull().defaultTo(0))
            .addColumn('created_at', 'bigint', (c) => c.notNull())
            .addColumn('updated_at', 'bigint', (c) => c.notNull()).execute();

        await schema.createTable('user_profiles').ifNotExists()
            .addColumn('qq', 'varchar(64)', (c) => c.primaryKey())
            .addColumn('display_name', 'text', (c) => c.notNull())
            .addColumn('created_at', 'bigint', (c) => c.notNull())
            .addColumn('updated_at', 'bigint', (c) => c.notNull()).execute();

        await schema.createTable('user_memories').ifNotExists()
            .addColumn('id', 'varchar(64)', (c) => c.primaryKey())
            .addColumn('qq', 'varchar(64)', (c) => c.notNull())
            .addColumn('scope', 'varchar(16)', (c) => c.notNull())
            .addColumn('content', 'text', (c) => c.notNull())
            .addColumn('importance', 'integer', (c) => c.notNull().defaultTo(3))
            .addColumn('confidence', 'integer', (c) => c.notNull().defaultTo(70))
            .addColumn('source_conversation_id', 'varchar(64)')
            .addColumn('source_message_id', 'varchar(64)')
            .addColumn('valid', 'integer', (c) => c.notNull().defaultTo(1))
            .addColumn('superseded_by', 'varchar(64)')
            .addColumn('use_count', 'integer', (c) => c.notNull().defaultTo(0))
            .addColumn('last_used_at', 'bigint')
            .addColumn('created_at', 'bigint', (c) => c.notNull())
            .addColumn('updated_at', 'bigint', (c) => c.notNull()).execute();

        await schema.createTable('blacklist_entries').ifNotExists()
            .addColumn('subject_type', 'varchar(16)', (c) => c.notNull())
            .addColumn('subject_id', 'varchar(64)', (c) => c.notNull())
            .addColumn('created_at', 'bigint', (c) => c.notNull())
            .addPrimaryKeyConstraint('blacklist_primary', ['subject_type', 'subject_id']).execute();

        await schema.createTable('stickers').ifNotExists()
            .addColumn('id', 'varchar(64)', (c) => c.primaryKey())
            .addColumn('napcat_key', 'varchar(512)')
            .addColumn('sha256', 'varchar(64)', (c) => c.notNull())
            .addColumn('phash', 'varchar(64)')
            .addColumn('path', 'text', (c) => c.notNull())
            .addColumn('mime', 'varchar(128)', (c) => c.notNull())
            .addColumn('summary', 'text', (c) => c.notNull())
            .addColumn('tags_json', 'text', (c) => c.notNull())
            .addColumn('safety_status', 'varchar(16)', (c) => c.notNull())
            .addColumn('seen_count', 'integer', (c) => c.notNull().defaultTo(0))
            .addColumn('use_count', 'integer', (c) => c.notNull().defaultTo(0))
            .addColumn('enabled', 'integer', (c) => c.notNull().defaultTo(1))
            .addColumn('first_seen_at', 'bigint', (c) => c.notNull())
            .addColumn('last_seen_at', 'bigint', (c) => c.notNull())
            .addColumn('last_used_at', 'bigint').execute();

        await schema.createTable('sticker_sightings').ifNotExists()
            .addColumn('id', 'varchar(64)', (c) => c.primaryKey())
            .addColumn('sticker_id', 'varchar(64)')
            .addColumn('conversation_id', 'varchar(64)', (c) => c.notNull())
            .addColumn('message_id', 'varchar(64)', (c) => c.notNull())
            .addColumn('fingerprint', 'text', (c) => c.notNull())
            .addColumn('seen_at', 'bigint', (c) => c.notNull()).execute();

        await schema.createTable('tool_executions').ifNotExists()
            .addColumn('idempotency_key', 'varchar(256)', (c) => c.primaryKey())
            .addColumn('conversation_id', 'varchar(64)', (c) => c.notNull())
            .addColumn('tool_name', 'varchar(64)', (c) => c.notNull())
            .addColumn('request_json', 'text', (c) => c.notNull())
            .addColumn('status', 'varchar(16)', (c) => c.notNull())
            .addColumn('result_json', 'text')
            .addColumn('created_at', 'bigint', (c) => c.notNull())
            .addColumn('updated_at', 'bigint', (c) => c.notNull()).execute();

        await this.createIndex('messages_conversation_seq_idx', 'messages', ['conversation_id', 'seq']);
        await this.createIndex('messages_batch_idx', 'messages', ['batch_id']);
        await this.createIndex('messages_napcat_idx', 'messages', ['conversation_id', 'napcat_message_id']);
        await this.createIndex('batches_status_idx', 'message_batches', ['status', 'last_message_at']);
        await this.createIndex('memories_qq_scope_idx', 'user_memories', ['qq', 'scope', 'valid']);
        await this.createIndex('stickers_hash_idx', 'stickers', ['sha256']);
        await this.createIndex('sightings_fingerprint_idx', 'sticker_sightings', ['fingerprint', 'seen_at']);
    }

    private async migrateV2(): Promise<void> {
        await this.db.schema.createTable('user_profiles').ifNotExists()
            .addColumn('qq', 'varchar(64)', (c) => c.primaryKey())
            .addColumn('display_name', 'text', (c) => c.notNull())
            .addColumn('created_at', 'bigint', (c) => c.notNull())
            .addColumn('updated_at', 'bigint', (c) => c.notNull()).execute();
    }

    private async createIndex(name: string, table: keyof DatabaseSchema & string, columns: string[]): Promise<void> {
        const builder = this.db.schema.createIndex(name).ifNotExists().on(table).columns(columns);
        try {
            await builder.execute();
        } catch (error) {
            if (this.driver !== 'mysql') throw error;
            // MySQL variants differ in CREATE INDEX IF NOT EXISTS support and duplicate-index errors.
        }
    }

    async healthCheck(): Promise<boolean> {
        try {
            await sql`select 1 as ok`.execute(this.db);
            return true;
        } catch {
            return false;
        }
    }

    async close(): Promise<void> {
        await this.db.destroy();
    }
}

function createNodeSqliteAdapter(database: DatabaseSync) {
    return {
        prepare(sql: string) {
            const statement = database.prepare(sql);
            const reader = /^\s*(?:select|pragma|with|explain)\b/i.test(sql) || /\breturning\b/i.test(sql);
            return {
                reader,
                all: (parameters: unknown[]) => statement.all(...(parameters as any[])),
                run: (parameters: unknown[]) => statement.run(...(parameters as any[])),
                iterate: (parameters: unknown[]) => statement.iterate(...(parameters as any[])),
            };
        },
        close: () => database.close(),
    };
}

export async function createDatabase(config: DatabaseConfig, dataPath: string, runMigrations = true): Promise<Database> {
    let dialect: Dialect;
    if (config.driver === 'sqlite') {
        const filename = path.isAbsolute(config.sqliteFile) ? config.sqliteFile : path.join(dataPath, config.sqliteFile);
        const sqlite = new DatabaseSync(filename);
        sqlite.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
        dialect = new SqliteDialect({ database: createNodeSqliteAdapter(sqlite) as never });
    } else if (config.driver === 'postgres') {
        if (!config.connectionString) throw new Error('PostgreSQL 连接串未配置');
        dialect = new PostgresDialect({
            pool: new PostgresPool({
                connectionString: config.connectionString,
                max: config.poolSize,
                ssl: config.tls ? true : undefined,
            }),
        });
    } else {
        if (!config.connectionString) throw new Error('MySQL 连接串未配置');
        dialect = new MysqlDialect({
            pool: createMysqlPool({
                uri: config.connectionString,
                connectionLimit: config.poolSize,
                ssl: config.tls ? {} : undefined,
            }),
        });
    }
    const database = new Database(new Kysely<DatabaseSchema>({ dialect }), config.driver);
    try {
        if (runMigrations) await database.migrate();
        if (!await database.healthCheck()) throw new Error('数据库健康检查失败');
        return database;
    } catch (error) {
        await database.close();
        throw error;
    }
}
