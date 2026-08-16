/**
 * dsh-color — color conversion toolbox for DeepSeek Harness.
 *
 * Three pure-math tools, zero runtime dependencies:
 *   convert_color  — parse any CSS color (hex / rgb() / hsl() / hwb() / named) and convert formats
 *   contrast_ratio — WCAG 2.x contrast ratio with AA/AAA verdicts for normal or large text
 *   color_info     — CSS named-color lookup by name substring or by exact value
 *
 * Everything is computed locally: no network, no filesystem, no side effects.
 *
 * @module dsh-color
 */

import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import z from '@deepseek-ai/schemastery'
import { buildColorTools, type ToolSet } from './tools.ts'

/** Stable Cordis plugin name (also the config key under `plugins:`). */
export const name = 'dsh-color'

/** Services required before tool registration can start. */
export const inject = ['agents', 'tools']

/** Plugin configuration (no tunables today — kept for schema completeness). */
export interface Config {
  /** Reserved for future options. */
  _?: never
}

export const Config: z<Config> = z.object({})

/** Register every color tool on one agent; returns the disposer. */
function decorate(agent: Agent, tools: ToolSet): () => void {
  const disposers = Object.values(tools).map((definition) => agent.ctx.tools.register(definition))
  return () => {
    for (const dispose of disposers) {
      try {
        dispose()
      } catch {
        // already disposed
      }
    }
  }
}

/** Mount the color tools on every live agent and every future one. */
export function apply(ctx: Context, _config: Config): void {
  const tools = buildColorTools()
  const disposers = new Set<() => void>()

  const decorateAgent = (agent: Agent): void => {
    try {
      disposers.add(decorate(agent, tools))
    } catch (error) {
      ctx.logger('color').warn(`tool registration for agent ${agent.id} failed: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  for (const agent of ctx.agents.list()) decorateAgent(agent)
  const off = ctx.on('agent/created', ({ agent }) => decorateAgent(agent))

  ctx.effect(() => () => {
    off()
    for (const dispose of disposers) {
      try {
        dispose()
      } catch {
        // already disposed
      }
    }
    disposers.clear()
  })
}
