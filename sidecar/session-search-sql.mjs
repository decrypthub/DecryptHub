// Copyright (c) 2026 DeepSeek. MIT; see docs/licenses/deepseek-harness-MIT.txt.
// Pure functions and selection SQL ported from query.ts and index.ts at ce7073d.
import { SessionQueryError } from "./session-query-values.mjs";
export const FTS_HIGHLIGHT_START="\uFDD0", FTS_HIGHLIGHT_END="\uFDD1";
const SQLITE_PORTABLE_VARIABLE_LIMIT=32766, SQLITE_FTS5_OUTER_PREDICATE_LIMIT=14;
export function assertPortableBindingCount(count) {
    if (count > SQLITE_PORTABLE_VARIABLE_LIMIT) {
        throw new SessionQueryError(`session-search request exceeds SQLite's portable ${SQLITE_PORTABLE_VARIABLE_LIMIT}-variable limit; reduce filter values`, 'SESSION_QUERY_INVALID_FILTER');
    }
}

export function assertFts5OuterPredicateCount(count) {
    if (count > SQLITE_FTS5_OUTER_PREDICATE_LIMIT) {
        throw new SessionQueryError(`session-search request exceeds the supported SQLite FTS5 outer-predicate budget of ${SQLITE_FTS5_OUTER_PREDICATE_LIMIT}; reduce filters`, 'SESSION_QUERY_INVALID_FILTER');
    }
}

export function buildSessionWhere(filters) {
    const clauses = [];
    const params = [];
    for (const filter of filters){
        switch(filter.kind){
            case 'id':
                addList(clauses, params, 'session_id', filter.values);
                break;
            case 'cwd':
                addNullableList(clauses, params, 'cwd', filter.values);
                break;
            case 'created-at':
                addRange(clauses, params, 'created_at', filter);
                break;
            case 'parent':
                addNullableList(clauses, params, 'parent_session', filter.values);
                break;
            case 'availability':
                {
                    const availability = [
                        ...new Set(filter.values)
                    ];
                    if (availability.length === 0) clauses.push('0');
                    else if (availability.length === 1) {
                        const value = availability[0];
                        switch(value){
                            case 'live':
                                clauses.push('live = 1');
                                break;
                            case 'persisted':
                                clauses.push('persisted = 1');
                                break;
                            default:
                                unknownAvailability(value);
                        }
                    }
                    break;
                }
            default:
                unknownFilter(filter);
        }
    }
    assertFts5OuterPredicateCount(clauses.length);
    return {
        sql: clauses.join(' AND '),
        params,
        predicateCount: clauses.length
    };
}

export function buildEventWhere(filters) {
    const clauses = [];
    const params = [];
    for (const filter of filters){
        switch(filter.kind){
            case 'seq':
                addRange(clauses, params, 'seq', filter);
                break;
            case 'time':
                addRange(clauses, params, 'time', filter);
                break;
            case 'type':
                addList(clauses, params, 'type', filter.values);
                break;
            case 'surface':
                addList(clauses, params, 'surface', filter.values);
                break;
            default:
                unknownFilter(filter);
        }
    }
    assertFts5OuterPredicateCount(clauses.length);
    return {
        sql: clauses.join(' AND '),
        params,
        predicateCount: clauses.length
    };
}

export function quoteFtsData(query) {
    return `"${query.replaceAll('"', '""')}"`;
}

export function sanitizeFtsText(text) {
    return text.replaceAll('\0', '\uFFFD').replaceAll(FTS_HIGHLIGHT_START, '\uFFFD').replaceAll(FTS_HIGHLIGHT_END, '\uFFFD');
}

export function makeSnippet(markedText, maxChars) {
    const { text: clean, matchStart } = normalizeMarkedText(markedText);
    const characters = Array.from(clean);
    if (characters.length <= maxChars) return clean;
    if (maxChars === 1) return '…';
    const matchedIndex = Math.min(matchStart, characters.length - 1);
    let start = Math.max(0, matchedIndex - Math.floor(maxChars / 3));
    const prefix = start > 0 ? '…' : '';
    let suffix = '…';
    let contentLength = maxChars - prefix.length - suffix.length;
    if (contentLength < 1) {
        start = matchedIndex;
        suffix = '';
        contentLength = maxChars - prefix.length - suffix.length;
    } else if (matchedIndex >= start + contentLength) {
        start = matchedIndex - contentLength + 1;
    }
    let end = Math.min(characters.length, start + contentLength);
    if (end === characters.length) {
        suffix = '';
        contentLength = maxChars - prefix.length;
        start = Math.max(0, end - contentLength);
    }
    end = Math.min(characters.length, start + contentLength);
    return `${prefix}${characters.slice(start, end).join('')}${suffix}`;
}

function normalizeMarkedText(markedText) {
    const characters = [];
    let matchStart;
    for (const character of markedText){
        if (character === FTS_HIGHLIGHT_START) {
            matchStart ??= characters.length;
            continue;
        }
        if (character === FTS_HIGHLIGHT_END) continue;
        if (/\s/u.test(character)) {
            if (characters.length > 0 && characters.at(-1) !== ' ') characters.push(' ');
        } else {
            characters.push(character);
        }
    }
    if (characters.at(-1) === ' ') characters.pop();
    return {
        text: characters.join(''),
        matchStart: matchStart ?? 0
    };
}

function addList(clauses, params, column, values) {
    if (values.length === 0) {
        clauses.push('0');
        return;
    }
    clauses.push(`${column} IN (${appendListBindings(params, values)})`);
}

function addNullableList(clauses, params, column, values) {
    if (values.length === 0) {
        clauses.push('0');
        return;
    }
    const concrete = values.filter((value)=>value !== null);
    const parts = [];
    if (concrete.length > 0) {
        parts.push(`${column} IN (${appendListBindings(params, concrete)})`);
    }
    if (values.includes(null)) parts.push(`${column} IS NULL`);
    clauses.push(`(${parts.join(' OR ')})`);
}

function addRange(clauses, params, column, range) {
    if (range.from !== undefined) {
        assertPortableBindingCount(params.length + 1);
        clauses.push(`CAST(${column} AS INTEGER) >= ?`);
        params.push(range.from);
    }
    if (range.to !== undefined) {
        assertPortableBindingCount(params.length + 1);
        clauses.push(`CAST(${column} AS INTEGER) <= ?`);
        params.push(range.to);
    }
}

function appendListBindings(params, values) {
    assertPortableBindingCount(params.length + values.length);
    for (const value of values)params.push(value);
    return values.map(()=>'?').join(', ');
}

function unknownAvailability(value) {
    throw new SessionQueryError(`session availability filter contains unknown value "${String(value)}"`, 'SESSION_QUERY_INVALID_FILTER');
}

function unknownFilter(filter) {
    const kind = filter.kind;
    throw new SessionQueryError(`session filter contains unknown kind ${typeof kind === 'string' ? `"${kind}"` : '(missing)'}`, 'SESSION_QUERY_INVALID_FILTER');
}
export function selectedDocumentsSql() {
    return {
        sql: `WITH candidates AS (
      SELECT
        pd.session_id AS session_id,
        ps.version AS version,
        ps.created_at AS created_at,
        ps.cwd AS cwd,
        ps.parent_session AS parent_session,
        ps.seed_length AS seed_length,
        ps.delegation_depth AS delegation_depth,
        ps.agent_preset AS agent_preset,
        0 AS live,
        1 AS persisted,
        CAST(pd.seq AS INTEGER) AS seq,
        pd.type AS type,
        CAST(pd.time AS INTEGER) AS time,
        pd.surface AS surface,
        highlight(persisted_docs, 0, ?, ?) AS marked_text,
        CAST(pd.codepoint_length AS INTEGER) AS document_length
      FROM persisted_docs AS pd
      JOIN persisted_sessions AS ps ON ps.id = pd.session_id
      WHERE persisted_docs MATCH ?
        AND ? = 1
        AND NOT EXISTS (SELECT 1 FROM temp.live_sessions AS ls WHERE ls.id = pd.session_id)
      UNION ALL
      SELECT
        ld.session_id AS session_id,
        ls.version AS version,
        ls.created_at AS created_at,
        ls.cwd AS cwd,
        ls.parent_session AS parent_session,
        ls.seed_length AS seed_length,
        ls.delegation_depth AS delegation_depth,
        ls.agent_preset AS agent_preset,
        1 AS live,
        CASE WHEN ? = 1 THEN ls.persisted ELSE 0 END AS persisted,
        CAST(ld.seq AS INTEGER) AS seq,
        ld.type AS type,
        CAST(ld.time AS INTEGER) AS time,
        ld.surface AS surface,
        highlight(live_docs, 0, ?, ?) AS marked_text,
        CAST(ld.codepoint_length AS INTEGER) AS document_length
      FROM temp.live_docs AS ld
      JOIN temp.live_sessions AS ls ON ls.id = ld.session_id
      WHERE live_docs MATCH ?
    ), matched AS (
      SELECT *,
        (
          length(CAST(marked_text AS BLOB))
          - length(CAST(replace(marked_text, ?, '') AS BLOB))
        ) / ? AS match_count
      FROM candidates
    )`
    };
}

export function selectedDocumentsParams(query, persistenceVisible) {
    const expression = quoteFtsData(query);
    const visible = persistenceVisible ? 1 : 0;
    return [
        FTS_HIGHLIGHT_START,
        FTS_HIGHLIGHT_END,
        expression,
        visible,
        visible,
        FTS_HIGHLIGHT_START,
        FTS_HIGHLIGHT_END,
        expression,
        FTS_HIGHLIGHT_START,
        Buffer.byteLength(FTS_HIGHLIGHT_START, 'utf8')
    ];
}
