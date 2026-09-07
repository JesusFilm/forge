import json,sys
from guard import Guard,digest
p=json.load(open(sys.argv[1]));g=Guard.__new__(Guard);g.p=p;print(json.dumps(g.expected(int(sys.argv[2]),sys.argv[3])))
