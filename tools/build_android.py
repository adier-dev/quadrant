"""Build the offline Android app with an installed JDK 17 and Android SDK 35.

No Gradle or third-party application dependencies. Signing keys stay local.
Set JAVA_HOME and ANDROID_HOME, or use tools under work/android-tools/.
"""
from pathlib import Path
import os
import secrets
import subprocess
import zipfile

ROOT = Path(__file__).resolve().parents[1]
TOOLS = ROOT/'work/android-tools'


def find(root, name):
    matches = list(root.rglob(name)) if root.exists() else []
    if not matches:
        raise SystemExit(f'Missing {name}: install JDK 17 / Android SDK 35 and set JAVA_HOME / ANDROID_HOME')
    return matches[0]


def main():
    jdk = Path(os.environ['JAVA_HOME']) if os.environ.get('JAVA_HOME') else find(TOOLS/'jdk', 'javac.exe').parent.parent
    sdk = Path(os.environ['ANDROID_HOME']) if os.environ.get('ANDROID_HOME') else TOOLS
    platform = sdk/'platforms/android-35/android.jar' if (sdk/'platforms').exists() else find(sdk/'platform', 'android.jar')
    tools = sdk/'build-tools/35.0.0' if (sdk/'build-tools/35.0.0').exists() else find(sdk/'build-tools', 'aapt2.exe').parent
    build = ROOT/'work/android-build'
    classes, dex = build/'classes', build/'dex'
    for folder in [build, classes, dex, ROOT/'releases', ROOT/'android-signing']:
        folder.mkdir(parents=True, exist_ok=True)
    # Only remove stale compiler outputs inside the checked build directory.
    for folder in [classes, dex]:
        for file in folder.rglob('*'):
            if file.is_file() and file.resolve().is_relative_to(build.resolve()):
                file.unlink()
    env = dict(os.environ, JAVA_HOME=str(jdk))
    env['PATH'] = str(jdk/'bin')+os.pathsep+env['PATH']

    def run(args):
        # aapt2 on Windows needs relative paths when the workspace name is Chinese.
        values=[str(x.relative_to(ROOT)) if isinstance(x,Path) and x.is_relative_to(ROOT) else str(x) for x in args]
        subprocess.run(values, cwd=ROOT, env=env, check=True)

    run([tools/'aapt2.exe', 'compile', '--dir', ROOT/'android/res', '-o', build/'resources.zip'])
    run([tools/'aapt2.exe', 'link', '-o', build/'unsigned.apk', '--manifest', ROOT/'android/AndroidManifest.xml',
         '-I', platform, '-A', ROOT/'web', build/'resources.zip'])
    run([jdk/'bin/javac.exe', '-encoding', 'UTF-8', '--release', '8', '-classpath', platform,
         '-d', classes, *sorted((ROOT/'android/src').rglob('*.java'))])
    run([jdk/'bin/java.exe', '-cp', tools/'lib/d8.jar', 'com.android.tools.r8.D8', '--min-api', '26',
         '--lib', platform, '--output', dex, *sorted(classes.rglob('*.class'))])
    with zipfile.ZipFile(build/'unsigned.apk', 'a', zipfile.ZIP_DEFLATED) as archive:
        for file in dex.glob('*.dex'):
            archive.write(file, file.name)
    run([tools/'zipalign.exe', '-f', '4', build/'unsigned.apk', build/'aligned.apk'])
    signing=ROOT/'android-signing'
    password=signing/'password.txt'
    if not password.exists():
        password.write_text(secrets.token_urlsafe(32), encoding='utf-8')
    env['QUADRANT_SIGNING_PASSWORD']=password.read_text(encoding='utf-8').strip()
    keystore=signing/'quadrant.p12'
    if not keystore.exists():
        run([jdk/'bin/keytool.exe', '-genkeypair', '-alias', 'quadrant', '-keyalg', 'RSA', '-keysize', '3072',
             '-validity', '10000', '-dname', 'CN=Quadrant Local App', '-storetype', 'PKCS12', '-keystore', keystore,
             '-storepass:env', 'QUADRANT_SIGNING_PASSWORD'])
    output=ROOT/'releases/Quadrant-Android.apk'
    run([jdk/'bin/java.exe', '-jar', tools/'lib/apksigner.jar', 'sign', '--ks', keystore, '--ks-key-alias', 'quadrant',
         '--ks-pass', 'env:QUADRANT_SIGNING_PASSWORD', '--out', output, build/'aligned.apk'])
    run([jdk/'bin/java.exe', '-jar', tools/'lib/apksigner.jar', 'verify', '--verbose', output])
    print('APK:', output)
    print('Keep android-signing/ safe: it is required for future app updates and excluded from Git.')


if __name__ == '__main__':
    main()
