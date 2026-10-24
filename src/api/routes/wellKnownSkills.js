import { Router } from 'express';
import { buildAgentSkillsIndex, buildSkillMarkdown } from '../../services/openApiService.js';
import { requestBaseUrl } from '../../services/pdfAccess.js';

export const wellKnownSkillsRouter = Router();

function skillMarkdownFor(req) {
  return buildSkillMarkdown({ baseUrl: requestBaseUrl(req) });
}

function sendSkillMarkdown(req, res) {
  res.type('text/markdown; charset=utf-8').send(skillMarkdownFor(req));
}

function sendSkillIndex(req, res) {
  res
    .type('application/json; charset=utf-8')
    .json(buildAgentSkillsIndex({ markdown: skillMarkdownFor(req) }));
}

const prefixes = ['/agent-skills', '/skills'];

for (const prefix of prefixes) {
  wellKnownSkillsRouter.get(`${prefix}/index.json`, sendSkillIndex);
  wellKnownSkillsRouter.get(`${prefix}/otero-open-api/SKILL.md`, sendSkillMarkdown);
}
