import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import request from 'supertest';
import { buildApp } from '../src/api/server.js';
import {
  AGENT_SKILLS_DISCOVERY_SCHEMA,
  OTERO_OPEN_API_SKILL_DESCRIPTION,
  OTERO_OPEN_API_SKILL_NAME,
  buildAgentSkillsIndex,
  buildSkillMarkdown,
  skillMarkdownDigest,
} from '../src/services/openApiService.js';
import { config } from '../src/config.js';
import { buildLlmsTxt } from '../src/services/seoService.js';

const app = buildApp();
const prefixes = ['/.well-known/agent-skills', '/.well-known/skills'];

test('buildAgentSkillsIndex digest matches the supplied markdown', () => {
  const markdown = buildSkillMarkdown({ baseUrl: 'https://ais-basket.xyz' });
  const index = buildAgentSkillsIndex({ markdown });
  const expected = `sha256:${createHash('sha256').update(markdown, 'utf8').digest('hex')}`;

  assert.equal(index.$schema, AGENT_SKILLS_DISCOVERY_SCHEMA);
  assert.equal(index.skills.length, 1);
  assert.equal(index.skills[0].name, OTERO_OPEN_API_SKILL_NAME);
  assert.equal(index.skills[0].type, 'skill-md');
  assert.equal(index.skills[0].description, OTERO_OPEN_API_SKILL_DESCRIPTION);
  assert.equal(index.skills[0].url, `${OTERO_OPEN_API_SKILL_NAME}/SKILL.md`);
  assert.match(index.skills[0].digest, /^sha256:[a-f0-9]{64}$/);
  assert.equal(index.skills[0].digest, expected);
  assert.equal(skillMarkdownDigest(markdown), expected);
  assert.match(markdown, /^---\nname: otero-open-api\n/m);
  assert.match(markdown, /https:\/\/ais-basket\.xyz\/api\/open\/v1/);
});

for (const prefix of prefixes) {
  test(`${prefix} index digest matches the same-host SKILL.md`, async () => {
    const host = 'skills.example.test';
    const indexRes = await request(app).get(`${prefix}/index.json`).set('Host', host).expect(200);
    const skillRes = await request(app)
      .get(`${prefix}/otero-open-api/SKILL.md`)
      .set('Host', host)
      .expect(200);

    assert.match(String(indexRes.headers['content-type']), /application\/json/);
    assert.match(String(skillRes.headers['content-type']), /text\/markdown/);

    const index = indexRes.body;
    assert.equal(index.$schema, AGENT_SKILLS_DISCOVERY_SCHEMA);
    assert.equal(index.skills[0].name, OTERO_OPEN_API_SKILL_NAME);
    assert.equal(index.skills[0].type, 'skill-md');
    assert.equal(index.skills[0].url, 'otero-open-api/SKILL.md');
    assert.match(index.skills[0].digest, /^sha256:[a-f0-9]{64}$/);
    assert.equal(index.skills[0].digest, skillMarkdownDigest(skillRes.text));
    assert.match(skillRes.text, /^---\nname: otero-open-api\n/m);
    assert.match(skillRes.text, new RegExp(`http://${host}/api/open/v1`));
  });
}

test('llms.txt advertises the skills CLI install command', () => {
  const prev = config.publicBaseUrl;
  config.publicBaseUrl = 'https://ais-basket.xyz';
  try {
    const txt = buildLlmsTxt();
    assert.match(txt, /npx skills add https:\/\/ais-basket\.xyz/);
    assert.match(txt, /\/\.well-known\/agent-skills\/index\.json/);
  } finally {
    config.publicBaseUrl = prev;
  }
});
