'use strict';
const { HttpError, str, oneOf } = require('../http.js');
const { tx, now } = require('../db.js');

function required(db, user) {
  if (user.roles.some(role => role !== 'athlete')) return false;
  const row = db.prepare('SELECT completed_at FROM member_welcome WHERE user_id=?').get(user.id);
  return !!row && !row.completed_at;
}

function routes(r, ctx) {
  const { db, auth } = ctx;
  r.get('/api/me/welcome', ({ user }) => {
    auth.require(user);
    const profile = db.prepare('SELECT id,sport,goals FROM athletes WHERE user_id=?').get(user.id);
    const saved = db.prepare('SELECT sport,goals,connection,completed_at FROM member_welcome WHERE user_id=?').get(user.id);
    return { name: user.name, email: user.email, athlete_id: profile?.id || null,
      sport: saved?.sport || profile?.sport || '', goals: saved?.goals || profile?.goals || '',
      connection: saved?.connection || '', completed_at: saved?.completed_at || null };
  });
  r.post('/api/me/welcome', ({ user, body }) => {
    auth.require(user);
    const name = str(body.name, 'name', { required: true, max: 80 });
    const sport = str(body.sport, 'sport', { max: 80 });
    const goals = str(body.goals, 'goals', { max: 2000 });
    const connection = oneOf(body.connection, ['new', 'claim', 'existing', 'later'], 'profile choice');
    return tx(db, () => {
      let athleteId = auth.ownAthleteId(user);
      // Retries and a coach connecting the account while the form is open must
      // never create another profile or overwrite that coach's existing record.
      if (!athleteId && connection === 'new') athleteId = ctx.createOwnAthlete({ ...user, name }, { sport, goals }).athlete.id;
      if (!athleteId && connection === 'claim') athleteId = ctx.claimAthlete(user, body.code).athlete.id;
      if (!athleteId && connection === 'existing') throw new HttpError(409, 'Your profile is not connected yet. Choose a connection option.');
      db.prepare('UPDATE users SET name=? WHERE id=?').run(name, user.id);
      db.prepare(`INSERT INTO member_welcome(user_id,completed_at,sport,goals,connection) VALUES(?,?,?,?,?)
        ON CONFLICT(user_id) DO UPDATE SET completed_at=excluded.completed_at,sport=excluded.sport,goals=excluded.goals,connection=excluded.connection`)
        .run(user.id, now(), sport, goals, athleteId && connection === 'later' ? 'existing' : connection);
      return { athlete_id: athleteId, welcome_required: false };
    });
  });
}
module.exports = { required, routes };
