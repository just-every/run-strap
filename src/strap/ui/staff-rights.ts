import { STAFF_RIGHTS, STAFF_ROLES } from '../domain/staff-rights';
import { body, field, form, h, hidden, panel, rows, select } from './shared';

export function staffRightsPanel(s: any) {
  const members = rows(s,'people').filter(p => p.active && p.email), places = rows(s,'locations');
  const grants = rows(s,'staffAccessGrants').map(g => `<li><strong>${h(members.find(p => p.id === g.personId)?.name ?? 'Inactive staff')}</strong> · ${h(g.role)} · ${g.enabled ? 'Active' : 'Revoked'}<p>${h(Object.keys(g.rights).filter(right => g.rights[right].enabled).join(', ') || 'No rights granted')}</p></li>`).join('');
  const fields = select('personId','Staff identity',members.map(p => [p.id,p.name+' · '+p.email]))
    + select('role','Staff role',STAFF_ROLES.map(role => [role,role.replace('-',' ')]))
    + select('enabled','Staff access',[['true','Enable selected rights'],['false','Revoke staff access']])
    + '<fieldset><legend>Named rights</legend>'+STAFF_RIGHTS.filter(right => right !== 'privacy').map(right => `<label class="check"><input type="checkbox" name="right_${h(right)}" value="true"> ${h(right.replaceAll('-',' '))}</label>`).join('')+'</fieldset>'
    + '<fieldset><legend>Permitted members</legend>'+members.filter(p => p.role === 'member').map(p => `<label class="check"><input type="checkbox" name="member_${h(p.id)}" value="true"> ${h(p.name)}</label>`).join('')+'</fieldset>'
    + '<fieldset><legend>Permitted locations</legend>'+places.map(l => `<label class="check"><input type="checkbox" name="location_${h(l.id)}" value="true"> ${h(l.name)}</label>`).join('')+'</fieldset>'
    + select('canCreate','May create member profiles',[['false','No'],['true','Yes']]);
  return panel('Staff rights',body('<p>Choose each right and its member and location scope. Saving replaces this person’s previous grants immediately. A role does not grant unchecked rights. Privacy stays owner-only; unsupported workflows remain unavailable.</p>'+(grants?'<ul>'+grants+'</ul>':'')+form('staff.access.grant','/app/security',fields,'Save staff rights')),{id:'staff-rights',icon:'key'});
}
