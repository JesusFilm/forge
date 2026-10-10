"""Bounded inert OCI artifact acquisition. No archive extraction or job execution."""
import hashlib
import json
import os
from pathlib import Path
import resource
import subprocess

from release import ReleaseRefused, matches, unique_object

ORAS_SHA256 = '040e140304b7dbdd9b40dacd798e2303cea44ad84eeb210750afdf15f1dcf8b4'


def oras(command, output, maximum, *, tool, registry_config):
    tool = Path(tool).resolve()
    if hashlib.sha256(tool.read_bytes()).hexdigest() != ORAS_SHA256:
        raise ReleaseRefused('Pinned ORAS executable required')
    def bound_output():
        resource.setrlimit(resource.RLIMIT_FSIZE, (maximum, maximum))
    env = {'PATH': '/usr/bin:/bin', 'LANG': 'C.UTF-8'}
    try:
        result = subprocess.run([str(tool), *command, '--registry-config', str(registry_config),
                                 '--output', str(output)], stdin=subprocess.DEVNULL,
                                stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                                env=env, timeout=120, preexec_fn=bound_output, check=False)
    except subprocess.TimeoutExpired as error:
        raise ReleaseRefused('Artifact acquisition timed out') from error
    if result.returncode:
        raise ReleaseRefused('Artifact acquisition failed')


def verified_payload_descriptor(manifest, reference, expected_sha256, maximum, title):
    if len(manifest) > 65536 or hashlib.sha256(manifest).hexdigest() != reference.rsplit('@sha256:', 1)[-1]:
        raise ReleaseRefused('Artifact manifest identity refused')
    try:
        value = json.loads(manifest, object_pairs_hook=unique_object)
    except (UnicodeDecodeError, ValueError, RecursionError) as error:
        raise ReleaseRefused('Artifact manifest JSON refused') from error
    if (not isinstance(value, dict) or value.get('schemaVersion') != 2
            or value.get('mediaType') != 'application/vnd.oci.image.manifest.v1+json'
            or not isinstance(value.get('layers'), list) or len(value['layers']) != 1):
        raise ReleaseRefused('Single-payload OCI artifact required')
    layer = value['layers'][0]
    if (not isinstance(layer, dict) or layer.get('digest') != 'sha256:' + expected_sha256
            or type(layer.get('size')) is not int or not 1 <= layer['size'] <= maximum
            or not isinstance(layer.get('annotations'), dict)
            or layer['annotations'].get('org.opencontainers.image.title') != title):
        raise ReleaseRefused('Artifact payload binding refused')
    return layer


def fetch_payload(reference, expected_sha256, maximum, title, directory, run):
    """Caller validates role-specific reference/approval before supplying run."""
    if not matches(reference, r'ghcr\.io/jesusfilm/forge-studio-(host|codec)@sha256:[a-f0-9]{64}'):
        raise ReleaseRefused('Owned immutable artifact required')
    if not matches(expected_sha256, '[a-f0-9]{64}') or title not in ('supervisor.tar', 'codec.tar.xz'):
        raise ReleaseRefused('Payload identity required')
    directory = Path(directory)
    manifest_path = directory / 'manifest.json'
    output = directory / title
    if manifest_path.exists() or output.exists() or manifest_path.is_symlink() or output.is_symlink():
        raise ReleaseRefused('Fresh private artifact staging required')
    run(['manifest', 'fetch', reference], manifest_path, 65536)
    manifest = manifest_path.read_bytes()
    layer = verified_payload_descriptor(manifest, reference, expected_sha256, maximum, title)
    source = reference.split('@', 1)[0] + '@' + layer['digest']
    run(['blob', 'fetch', source], output, maximum)
    with output.open('rb') as file:
        digest = hashlib.file_digest(file, 'sha256').hexdigest()
    if output.stat().st_size != layer['size'] or digest != expected_sha256:
        raise ReleaseRefused('Artifact payload bytes differ')
    return output


def verify_oci_archive(path, expected_digest, *, image, payload=None):
    """Hash bounded regular OCI members in place; never extract candidate paths."""
    import tarfile
    if expected_digest is not None and not matches(expected_digest, 'sha256:[a-f0-9]{64}'):
        raise ReleaseRefused('Exact OCI manifest required')
    if Path(path).is_symlink() or Path(path).stat().st_size > 8 * 1024**3:
        raise ReleaseRefused('OCI archive size/type refused')
    check_tar_metadata(path)
    try:
        with tarfile.open(path, 'r:') as archive:
            entries = {}
            total = 0
            for entry in archive:
                if entry.isdir() and entry.name in ('blobs', 'blobs/sha256'):
                    continue
                if (len(entries) >= 16384 or not entry.isfile() or entry.name in entries
                        or not matches(entry.name, r'(index\.json|oci-layout|blobs/sha256/[a-f0-9]{64})')):
                    raise ReleaseRefused('OCI member layout refused')
                total += entry.size
                if total > 8 * 1024**3 or entry.size < 0:
                    raise ReleaseRefused('OCI payload bound refused')
                if entry.name.startswith('blobs/'):
                    with archive.extractfile(entry) as source:
                        if hashlib.file_digest(source, 'sha256').hexdigest() != entry.name.rsplit('/', 1)[1]:
                            raise ReleaseRefused('OCI blob checksum refused')
                entries[entry.name] = entry
            def read_json(name):
                entry = entries.get(name)
                if entry is None or entry.size > 1048576:
                    raise ReleaseRefused('Bounded OCI metadata required')
                return json.loads(archive.extractfile(entry).read(), object_pairs_hook=unique_object)
            if read_json('oci-layout') != {'imageLayoutVersion': '1.0.0'}:
                raise ReleaseRefused('OCI layout version refused')
            index = read_json('index.json')
            if not isinstance(index, dict) or not isinstance(index.get('manifests'), list) or len(index['manifests']) != 1:
                raise ReleaseRefused('Exactly one OCI manifest required')
            descriptor = index['manifests'][0]
            if not isinstance(descriptor, dict) or not matches(descriptor.get('digest'), 'sha256:[a-f0-9]{64}'):
                raise ReleaseRefused('OCI manifest descriptor refused')
            digest = descriptor['digest']
            if expected_digest is not None and digest != expected_digest:
                raise ReleaseRefused('OCI differs from approved candidate')
            def descriptor_name(value):
                if not isinstance(value, dict) or not matches(value.get('digest'), 'sha256:[a-f0-9]{64}') or type(value.get('size')) is not int:
                    raise ReleaseRefused('OCI descriptor refused')
                name = 'blobs/sha256/' + value['digest'][7:]
                if name not in entries or entries[name].size != value['size']:
                    raise ReleaseRefused('OCI descriptor bytes missing')
                return name
            manifest = read_json(descriptor_name(descriptor))
            if (not isinstance(manifest, dict) or manifest.get('mediaType') != 'application/vnd.oci.image.manifest.v1+json'
                    or not isinstance(manifest.get('layers'), list)):
                raise ReleaseRefused('Single OCI image/artifact manifest required')
            config = read_json(descriptor_name(manifest.get('config')))
            for layer in manifest['layers']:
                descriptor_name(layer)
            if payload is not None:
                manifest_raw = archive.extractfile(entries[descriptor_name(descriptor)]).read()
                layer = verified_payload_descriptor(manifest_raw, 'local@' + digest, payload['sha256'], 150000000, 'supervisor.tar')
                if layer['size'] != payload['size']:
                    raise ReleaseRefused('Host payload size differs from candidate')
            if image and (not isinstance(config, dict) or config.get('os') != 'linux' or config.get('architecture') != 'amd64'):
                raise ReleaseRefused('Exact linux/amd64 image required')
            return digest
    except (tarfile.TarError, OSError, ValueError, RecursionError) as error:
        raise ReleaseRefused('OCI archive refused') from error


def unpack_candidate(path, destination, digest, target):
    import stat
    import zipfile
    from release import verify_candidate
    if Path(path).stat().st_size > 8 * 1024**3:
        raise ReleaseRefused('Candidate download exceeds bound')
    names = {'candidate.json', 'render.oci.tar', 'verify.oci.tar', 'host.oci.tar'}
    check_zip_directory(path)
    try:
        with zipfile.ZipFile(path) as archive:
            entries = archive.infolist()
            if len(entries) != 4 or {entry.filename for entry in entries} != names:
                raise ReleaseRefused('Candidate ZIP members refused')
            total = 0
            for entry in entries:
                mode = entry.external_attr >> 16
                if (entry.is_dir() or stat.S_IFMT(mode) not in (0, stat.S_IFREG)
                        or entry.flag_bits & 1 or entry.compress_type not in (zipfile.ZIP_STORED, zipfile.ZIP_DEFLATED)
                        or entry.file_size < 0):
                    raise ReleaseRefused('Candidate ZIP member type refused')
                total += entry.file_size
            if total > 8 * 1024**3 or archive.getinfo('candidate.json').file_size > 65536:
                raise ReleaseRefused('Candidate ZIP expansion exceeds bound')
            raw = archive.read('candidate.json')
            verify_candidate(raw, digest, target)
            destination = Path(destination)
            destination.mkdir(mode=0o700)
            # All member paths and expansion bounds were checked before writes.
            # Fixed allowlisted names cannot select host/repository paths.
            for entry in entries:
                with archive.open(entry) as source, (destination / entry.filename).open('xb') as output:
                    os.fchmod(output.fileno(), 0o600)
                    remaining = entry.file_size
                    while remaining:
                        chunk = source.read(min(1048576, remaining))
                        if not chunk:
                            raise ReleaseRefused('Truncated candidate ZIP member')
                        output.write(chunk)
                        remaining -= len(chunk)
                    if source.read(1):
                        raise ReleaseRefused('Candidate ZIP member exceeds declared size')
    except (zipfile.BadZipFile, OSError, ValueError) as error:
        raise ReleaseRefused('Candidate download refused') from error


def check_zip_directory(path):
    """Bound the central-directory allocation before Python's ZIP reader opens it."""
    import struct
    with Path(path).open('rb') as source:
        size = source.seek(0, 2)
        source.seek(max(0, size - 65557))
        tail = source.read(65557)
        offset = tail.rfind(b'PK\x05\x06')
        if offset < 0 or offset + 22 > len(tail):
            raise ReleaseRefused('ZIP directory footer required')
        _, disk, start_disk, disk_count, count, length, start, comment = struct.unpack('<4s4H2LH', tail[offset:offset + 22])
        if offset + 22 + comment != len(tail) or disk != 0 or start_disk != 0:
            raise ReleaseRefused('Multipart or ambiguous ZIP refused')
        footer = size - len(tail) + offset
        if count == 65535 or length == 0xffffffff or start == 0xffffffff:
            if footer < 20:
                raise ReleaseRefused('ZIP64 locator missing')
            source.seek(footer - 20)
            signature, record_disk, record_offset, disks = struct.unpack('<4sLQL', source.read(20))
            if signature != b'PK\x06\x07' or record_disk != 0 or disks != 1 or record_offset + 56 > footer - 20:
                raise ReleaseRefused('ZIP64 locator refused')
            source.seek(record_offset)
            header = source.read(56)
            signature, record_size, _, _, disk, start_disk, disk_count, count, length, start = struct.unpack('<4sQ2H2L4Q', header)
            if signature != b'PK\x06\x06' or not 44 <= record_size <= 1024 or record_offset + 12 + record_size != footer - 20:
                raise ReleaseRefused('ZIP64 directory refused')
            footer = record_offset
        if disk != 0 or start_disk != 0 or disk_count != 4 or count != 4 or length > 65536 or start + length != footer:
            raise ReleaseRefused('Bounded four-member ZIP directory required')


def check_tar_metadata(path):
    """Reject oversized extended headers before tarfile allocates their bodies."""
    import tarfile
    metadata = 0
    try:
        with Path(path).open('rb') as source:
            length = source.seek(0, 2)
            source.seek(0)
            for _ in range(32768):
                header = source.read(512)
                if header == b'\0' * 512:
                    return
                if len(header) != 512:
                    raise ReleaseRefused('Truncated OCI tar header')
                entry = tarfile.TarInfo.frombuf(header, 'utf-8', 'surrogateescape')
                if entry.size < 0 or entry.size > 8 * 1024**3:
                    raise ReleaseRefused('OCI tar member size refused')
                if entry.type in (tarfile.XHDTYPE, tarfile.XGLTYPE, tarfile.GNUTYPE_LONGNAME):
                    metadata += entry.size
                    if entry.size > 65536 or metadata > 1048576:
                        raise ReleaseRefused('OCI extended metadata exceeds bound')
                elif entry.type not in (tarfile.REGTYPE, tarfile.AREGTYPE, tarfile.DIRTYPE):
                    raise ReleaseRefused('OCI tar member type refused')
                following = source.tell() + ((entry.size + 511) // 512) * 512
                if following > length:
                    raise ReleaseRefused('Truncated OCI tar member')
                source.seek(following)
        raise ReleaseRefused('OCI tar metadata count exceeds bound')
    except (tarfile.TarError, OSError, ValueError) as error:
        raise ReleaseRefused('OCI tar metadata refused') from error
