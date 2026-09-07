import sys,json
from pathlib import Path
from guard import Guard
command,path,proposal_file,input_file=sys.argv[1:]
g=Guard(path,json.loads(Path(proposal_file).read_text()));v=json.loads(Path(input_file).read_text())
try:
 if command=='reserve':print(json.dumps(g.reserve(v['slot'],v['ordinal'],v['attempt'],v['admission'],v['raw'].encode())))
 elif command=='finish':g.finish(v['claim'],v['state'],v['result']);print('{"recorded":true}')
 else:raise ValueError('Unknown action')
finally:g.close()
