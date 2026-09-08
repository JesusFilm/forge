from pathlib import Path
import re,json,hashlib,subprocess
base=Path.cwd().parent
paths=sorted(Path('apps/admin/prisma/migrations').glob('*/migration.sql'))
expected={p.parent.name:hashlib.sha256(p.read_bytes()).hexdigest() for p in paths}
report={'migrationCount':len(paths),'ledgers':{}}
for name in ['database-inventory','upgrade-ledger']:
 rows=re.findall(r'^\s*(\S+)\s*\|\s*t\s*\|\s*f\s*\|\s*([a-f0-9]{64})\s*$',(base/'logs'/f'{name}.log').read_text(),re.M)
 actual=dict(rows)
 assert actual==expected,(name,len(actual))
 report['ledgers'][name]={'count':len(actual),'allFinished':True,'noneRolledBack':True,'allSourceChecksumsMatch':True}
parents=['3ee2451a8ee717fe090890cc03446ee5d2bf6a01','1ce69015e0e2fe7273e092fa14afdfaea5a06cc3']
report['parentMigrationPreservation']={}
for parent in parents:
 names=subprocess.check_output(['git','ls-tree','-r','--name-only',parent,'apps/admin/prisma/migrations'],text=True).splitlines()
 for name in names:
  assert Path(name).read_bytes()==subprocess.check_output(['git','show',f'{parent}:{name}']),name
 report['parentMigrationPreservation'][parent]={'files':len(names),'unchanged':True}
drift=(base/'logs/migration-schema-diff.log').read_text()
report['schemaDiff']={'studioStatements':len(re.findall(r'^[^\n]*"studio_[^\n]*$',drift,re.M)),'applied':False,'qualification':'Nonempty inherited non-Studio drift retained; this command exit 0 means diff computed, not zero drift. No generated drift SQL applied. Both parents migration bytes preserved.'}
assert report['schemaDiff']['studioStatements']==0
(base/'evidence/ledger-verification.json').write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps(report,indent=2))
