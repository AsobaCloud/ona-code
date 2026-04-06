import fs from 'node:fs'
import path from 'node:path'
import { onaHome } from './paths.mjs'

const TEAMS_DIR = path.join(onaHome(), 'teams')

function teamFilePath(name) {
  return path.join(TEAMS_DIR, `${name.replace(/[^a-zA-Z0-9._-]/g, '_')}.json`)
}

export function createTeam(name, leadSessionId) {
  fs.mkdirSync(TEAMS_DIR, { recursive: true })
  const team = {
    name,
    createdAt: Date.now(),
    leadSessionId,
    members: [],
  }
  fs.writeFileSync(teamFilePath(name), JSON.stringify(team, null, 2), 'utf8')
  return team
}

export function getTeam(name) {
  const p = teamFilePath(name)
  if (!fs.existsSync(p)) return null
  try { return JSON.parse(fs.readFileSync(p, 'utf8')) } catch { return null }
}

export function listTeams() {
  if (!fs.existsSync(TEAMS_DIR)) return []
  return fs.readdirSync(TEAMS_DIR)
    .filter(f => f.endsWith('.json'))
    .map(f => {
      try { return JSON.parse(fs.readFileSync(path.join(TEAMS_DIR, f), 'utf8')) }
      catch { return null }
    })
    .filter(Boolean)
}

export function addTeammate(teamName, memberName, sessionId) {
  const team = getTeam(teamName)
  if (!team) return null
  const agentId = `${memberName}@${teamName}`
  const member = {
    agentId,
    name: memberName,
    isActive: true,
    sessionId,
    joinedAt: Date.now(),
  }
  team.members.push(member)
  fs.writeFileSync(teamFilePath(teamName), JSON.stringify(team, null, 2), 'utf8')
  return member
}

export function setTeammateIdle(teamName, agentId) {
  const team = getTeam(teamName)
  if (!team) return false
  const member = team.members.find(m => m.agentId === agentId)
  if (!member) return false
  member.isActive = false
  fs.writeFileSync(teamFilePath(teamName), JSON.stringify(team, null, 2), 'utf8')
  return true
}

export function deleteTeam(name) {
  const p = teamFilePath(name)
  try { fs.unlinkSync(p); return true } catch { return false }
}
