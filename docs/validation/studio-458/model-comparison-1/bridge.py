"""Transport wrapper around unchanged reviewed Guard; stdin avoids new evidence inodes."""
import json,sys,fcntl,sqlite3,os
from pathlib import Path
sys.path.insert(0,str(Path(__file__).parents[1]/'dry-verified'))
from guard import Guard,Rejected
command,ledger,proposal=sys.argv[1:];v=json.load(sys.stdin)
if command in ('state','stop') and not Path(ledger).exists():raise Rejected('No owned ledger')
g=Guard(ledger,json.loads(Path(proposal).read_text()))
try:
 # All adapter reservations share the existing ledger inode as their lock;
 # no extra lock file or replacement database is needed.
 with open(ledger,'rb') as lock:
  fcntl.flock(lock,fcntl.LOCK_EX)
  if command=='reserve':
   if g.db.execute("SELECT 1 FROM calls WHERE state!='COMPLETED'").fetchone():raise Rejected('Earlier unresolved/failed transport claim; no new dispatch')
   result=g.reserve(v['slot'],v['ordinal'],v['attempt'],v['admission'],v['raw'].encode())
  elif command=='finish':
   g.finish(v['claim'],v['state'],v['result']);result={'state':g.db.execute('SELECT state FROM calls WHERE slot=? AND ordinal=?',(v['claim']['slot'],v['claim']['ordinal'])).fetchone()[0]}
  elif command=='stop':
   c=v['claim'];g.db.execute('BEGIN IMMEDIATE')
   if not g.db.execute('SELECT 1 FROM calls WHERE slot=? AND ordinal=? AND owner=? AND digest=?',(c['slot'],c['ordinal'],c['owner'],c['digest'])).fetchone():g.db.execute('ROLLBACK');raise Rejected('Only claim owner may stop transport')
   g.db.execute('UPDATE batch SET stopped=1');g.db.execute('COMMIT');result={'stopped':True}
  else:raise Rejected('Unknown bridge command')
  print(json.dumps(result))
finally:g.close()
