import assert from 'node:assert/strict';

export function taxEdge() {
  const calls = [], calculations = new Map(), transactions = new Map();
  let uncertain = false, live = false;
  const outbound = async request=>{
    const url = new URL(request.url), form = new URLSearchParams(await request.text());
    calls.push({path:url.pathname,method:request.method,form});
    const sequence = calls.length, json = body=>Response.json(body,{headers:{'request-id':'synthetic-strap-'+sequence}});
    if (url.pathname === '/v1/tax/settings') return json({object:'tax.settings',livemode:live,status:'active'});
    if (url.pathname === '/v1/tax/registrations') return json({object:'list',has_more:false,data:['WA','CA'].map(state=>({id:'synthetic-strap-'+state,object:'tax.registration',livemode:false,status:'active',country:'US',country_options:{us:{state}}}))});
    const reference = form.get('line_items[0][reference]');
    if (url.pathname === '/v1/tax/calculations') {
      const amount = Number(form.get('line_items[0][amount]')), taxCode = form.get('line_items[0][tax_code]');
      assert.equal(form.get('currency'),'usd'); assert.equal(form.get('line_items[0][tax_behavior]'),'exclusive');
      const tax = form.get('customer_details[taxability_override]') === 'customer_exempt' || taxCode === 'txcd_50021003' ? 0 : amount/10;
      const body = {id:'synthetic-strap-calculation-'+sequence,object:'tax.calculation',livemode:false,currency:'usd',tax_date:Number(form.get('tax_date')),customer_details:{address:{country:'US',state:form.get('customer_details[address][state]')}},amount_total:amount+tax,tax_amount_exclusive:tax,tax_amount_inclusive:0,tax_breakdown:[{amount:tax,taxability_reason:tax > 0 ? 'standard_rated' : form.get('customer_details[taxability_override]') === 'customer_exempt' ? 'customer_exempt' : 'product_exempt'}],expires_at:Math.floor(Date.now()/1000)+3600,
        line_items:{has_more:false,data:[{id:'synthetic-strap-line-'+sequence,quantity:Number(form.get('line_items[0][quantity]')),amount,amount_tax:tax,tax_code:taxCode,tax_behavior:'exclusive',livemode:false,reference}]}};
      calculations.set(body.id,body); return json(body);
    }
    if (url.pathname === '/v1/tax/transactions/create_from_calculation') {
      if (uncertain) return new Response('Uncertain upstream response',{status:502});
      const calculation = calculations.get(form.get('calculation')); assert.ok(calculation);
      const body = {id:'synthetic-strap-transaction-'+sequence,object:'tax.transaction',type:'transaction',livemode:false,currency:'usd',reference:form.get('reference'),line_items:{has_more:false,data:[{...calculation.line_items.data[0],id:'synthetic-strap-transaction-line-'+sequence}]}};
      transactions.set(body.id,body); return json(body);
    }
    assert.equal(url.pathname,'/v1/tax/transactions/create_reversal');
    const original = transactions.get(form.get('original_transaction')); assert.ok(original);
    assert.equal(form.get('mode'),'partial'); assert.equal(form.get('line_items[0][original_line_item]'),original.line_items.data[0].id);
    return json({id:'synthetic-strap-reversal-'+sequence,object:'tax.transaction',type:'reversal',livemode:false,currency:'usd',reference:form.get('reference'),reversal:{original_transaction:original.id},line_items:{has_more:false,data:[{...original.line_items.data[0],id:'synthetic-strap-reversed-line-'+sequence,amount:Number(form.get('line_items[0][amount]')),amount_tax:Number(form.get('line_items[0][amount_tax]')),reference,reversal:{original_line_item:original.line_items.data[0].id}}]}});
  };
  return {calls,outbound,setUncertain:value=>uncertain=value,setLive:value=>live=value};
}
