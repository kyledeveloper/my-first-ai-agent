class ExperienceRetriever {
  constructor(database) {
    this.db = database;
  }

  /**
   * Tokenize input into search tokens supporting English words, numbers, and CJK (Chinese/Japanese/Korean)
   * bigrams and unigrams for accurate full-text matching without external segmenters.
   */
  extractTokens(text) {
    if (!text || typeof text !== 'string') return [];
    const clean = text.replace(/[^\p{L}\p{N}_\s-]/gu, ' ').trim();
    const latin = clean.match(/[a-zA-Z0-9_-]{2,}/g) || [];
    const cjkChars = clean.match(/[\u4e00-\u9fa5]/g) || [];
    const cjkBigrams = [];
    for (let i = 0; i < cjkChars.length - 1; i++) {
      cjkBigrams.push(cjkChars[i] + cjkChars[i + 1]);
    }
    // Return high-value tokens (latin words + cjk bigrams + standalone cjk if short)
    const combined = [...latin, ...cjkBigrams];
    if (combined.length === 0 && cjkChars.length > 0) {
      combined.push(...cjkChars);
    }
    return Array.from(new Set(combined)).filter(t => t.length >= 2);
  }

  /**
   * Clean and prepare user query into FTS5 safe search query
   */
  sanitizeFtsQuery(query) {
    const tokens = this.extractTokens(query);
    if (tokens.length === 0) return '';
    // Format tokens as FTS5 OR match
    return tokens.map(t => `"${t}"*`).join(' OR ');
  }

  /**
   * Search for relevant past reflections given a task intent and optional domain tags.
   */
  searchLessons(query, { domainTags = [], limit = 3, autoIncrementHit = false } = {}) {
    const tokens = this.extractTokens(query);
    const ftsQuery = this.sanitizeFtsQuery(query);
    let results = [];

    if (ftsQuery) {
      try {
        const sql = `
          SELECT r.id, r.trigger_pattern, r.failure_mode, r.root_cause, r.corrective_heuristic,
                 r.confidence_score, r.hit_count, rank
          FROM experience_fts
          JOIN reflections r ON r.id = experience_fts.reflection_id
          WHERE experience_fts MATCH ?
          ORDER BY rank
          LIMIT ?
        `;
        results = this.db.db.prepare(sql).all(ftsQuery, limit * 2);
      } catch (err) {
        results = [];
      }
    }

    // Comprehensive LIKE query fallback if FTS has no hits
    if (results.length === 0 && tokens.length > 0) {
      const targetTokens = tokens.slice(0, 5);
      const clauses = targetTokens.map(() => `(
        e.intent LIKE ? OR
        r.trigger_pattern LIKE ? OR
        r.failure_mode LIKE ? OR
        r.root_cause LIKE ? OR
        r.corrective_heuristic LIKE ?
      )`).join(' OR ');

      const params = [];
      for (const tok of targetTokens) {
        params.push(`%${tok}%`, `%${tok}%`, `%${tok}%`, `%${tok}%`, `%${tok}%`);
      }
      params.push(limit);

      const fallbackSql = `
        SELECT r.id, r.trigger_pattern, r.failure_mode, r.root_cause, r.corrective_heuristic,
               r.confidence_score, r.hit_count, 0 as rank
        FROM reflections r
        JOIN episodes e ON e.id = r.episode_id
        WHERE ${clauses}
        ORDER BY r.hit_count DESC
        LIMIT ?
      `;

      try {
        results = this.db.db.prepare(fallbackSql).all(...params);
      } catch (e) {
        results = [];
      }
    }

    // Tag filtering / boosting if domainTags provided
    const scored = results.map(row => {
      let boost = 1.0;
      if (domainTags.length > 0) {
        const rowEpisode = this.db.db.prepare('SELECT domain_tags FROM episodes WHERE id = (SELECT episode_id FROM reflections WHERE id = ?)').get(row.id);
        if (rowEpisode && rowEpisode.domain_tags) {
          try {
            const tags = JSON.parse(rowEpisode.domain_tags);
            const overlap = domainTags.filter(t => tags.includes(t)).length;
            boost += overlap * 0.5;
          } catch (e) {}
        }
      }
      return {
        ...row,
        score: (row.confidence_score || 1.0) * boost * (1 + Math.log10((row.hit_count || 1) + 1))
      };
    });

    scored.sort((a, b) => b.score - a.score);
    const topResults = scored.slice(0, limit);

    if (autoIncrementHit) {
      for (const item of topResults) {
        this.db.incrementHitCount(item.id);
      }
    }

    return topResults;
  }

  /**
   * Format retrieved lessons into high-density, low-token Markdown for prompt injection.
   */
  formatForPrompt(lessons) {
    if (!lessons || lessons.length === 0) return '';

    const lines = [
      '> [!IMPORTANT]',
      '> **历史反思经验提示 (Reflexion Memory)**:'
    ];

    for (const l of lessons) {
      lines.push(`> • **场景**: ${l.trigger_pattern}`);
      lines.push(`>   **避坑指南**: ${l.corrective_heuristic} *(根因: ${l.root_cause})*`);
    }

    return lines.join('\n');
  }
}

module.exports = { ExperienceRetriever };
