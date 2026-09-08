# Task-owned unpacker for our own checksum-verified local BuildKit OCI export.
import hashlib,json,tarfile,pathlib,subprocess,shutil
base=pathlib.Path('/home/tataihono/.cache/forge-studio-460-image-runtime')
root=base/'membership-oci-bundle/rootfs'
root.mkdir()
with tarfile.open(base/'studio-render-membership.oci.tar') as outer:
 def content(d):
  algorithm,digest=d['digest'].split(':')
  assert algorithm=='sha256'
  b=outer.extractfile('blobs/sha256/'+digest).read()
  assert len(b)==d['size'] and hashlib.sha256(b).hexdigest()==digest
  return b
 index=json.load(outer.extractfile('index.json'))
 descriptor=index['manifests'][0]
 manifest=json.loads(content(descriptor))
 while 'manifests' in manifest:
  descriptor=next(d for d in manifest['manifests'] if d.get('platform',{}).get('architecture')=='amd64')
  manifest=json.loads(content(descriptor))
 config=json.loads(content(manifest['config']))
 assert config['architecture']=='amd64' and config['os']=='linux'
 assert config['config']['Entrypoint']==['/opt/studio-render/native/entrypoint']
 assert config['config']['User']=='1000:1000'
 (base/'evidence/membership-image-config.json').write_text(json.dumps(config,indent=2)+'\n')
 (base/'evidence/membership-image-manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
 for number,d in enumerate(manifest['layers']):
  layer=base/'membership-layer.tar'
  layer.write_bytes(content(d))
  with tarfile.open(layer) as tar:
   for entry in tar:
    path=pathlib.PurePosixPath(entry.name)
    assert not path.is_absolute() and '..' not in path.parts
    if path.name.startswith('.wh.'):
     parent=root.joinpath(*path.parent.parts)
     targets=list(parent.iterdir()) if path.name=='.wh..wh..opq' and parent.exists() else [parent/path.name[4:]]
     for target in targets:
      if target.is_dir() and not target.is_symlink(): shutil.rmtree(target)
      else: target.unlink(missing_ok=True)
  subprocess.run(['tar','--extract','--file',str(layer),'--directory',str(root),'--exclude=.wh.*','--same-owner'],check=True)
  layer.unlink()
  print('verified/extracted layer',number,d['digest'],flush=True)
 print('IMAGE',descriptor['digest'],flush=True)
