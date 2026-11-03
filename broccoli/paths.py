"""Choose existing user data and safely migrate the legacy policy filename."""
from pathlib import Path

DATABASE='broccoli.sqlite3'
LEGACY_DATABASE='hotturkey.sqlite3'
DATABASE_FILES={name+suffix for name in (DATABASE,LEGACY_DATABASE) for suffix in ('','-wal','-shm')}


def policy_database(directory):
    directory=Path(directory);current=directory/DATABASE;legacy=directory/LEGACY_DATABASE
    if current.is_file():
        if legacy.is_file() and not current.samefile(legacy):raise ValueError('检测到两个不同的规则数据库，请先确认要保留的数据')
        return current
    return legacy if legacy.is_file() else current


def user_data_directory(home=None):
    base=(Path(home) if home is not None else Path.home())/'Library/Application Support'
    current=base/'Broccoli';legacy=base/'HotTurkey'
    a=policy_database(current);b=policy_database(legacy)
    if a.is_file():
        if b.is_file() and not a.samefile(b):raise ValueError('检测到两个不同的数据目录，请先确认要保留的数据库')
        return current
    return legacy if b.is_file() else current


def migrate_policy_database(directory):
    """The caller stops its backend first; the lease prevents a second writer."""
    import sqlite3,uuid
    from .service_lease import ServiceLease
    directory=Path(directory);legacy=directory/LEGACY_DATABASE;current=directory/DATABASE
    selected=policy_database(directory)
    if selected==current or not legacy.exists():return False
    if legacy.is_symlink():raise ValueError('规则数据库不能是符号链接')
    with ServiceLease(directory/'service.lock'):
        db=sqlite3.connect(str(legacy),timeout=2)
        try:
            result=db.execute('PRAGMA wal_checkpoint(TRUNCATE)').fetchone()
            if result and result[0]:raise ValueError('规则数据库仍在使用，请停止后台后重试')
            if db.execute('PRAGMA journal_mode=DELETE').fetchone()[0]!='delete':raise ValueError('规则数据库仍在使用，请关闭其他连接后重试')
        except sqlite3.OperationalError:raise ValueError('规则数据库仍在使用，请关闭其他连接后重试') from None
        finally:db.close()
        sidecars=[Path(str(legacy)+suffix) for suffix in ('-wal','-shm') if Path(str(legacy)+suffix).exists()]
        if any(p.name.endswith('-wal') and p.stat().st_size for p in sidecars):raise ValueError('规则数据库仍在使用，请关闭其他连接后重试')
        # macOS SQLite can retain an inactive SHM file after leaving WAL mode.
        # Keep it as a private backup; never rename a live journal independently.
        moved=[]
        try:
            if sidecars:
                archive=directory/'Database Migration Backups'/uuid.uuid4().hex;archive.mkdir(mode=0o700,parents=True)
                archive.parent.chmod(0o700)
                for p in sidecars:
                    destination=archive/p.name;p.rename(destination);moved.append((p,destination))
            legacy.rename(current)
        except BaseException:
            for original,backup in reversed(moved):backup.rename(original)
            raise
    return True
