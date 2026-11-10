import subprocess
import re
import sys

def main():
    print("Fetching deployments...")
    res = subprocess.run("npx @google/clasp deployments", capture_output=True, text=True, shell=True)
    output = res.stdout
    if res.returncode != 0:
        print("Error fetching deployments:", res.stderr)
        sys.exit(1)

    dep_ids = re.findall(r"-\s+(AKfycb[a-zA-Z0-9_-]+)", output)
    if not dep_ids:
        print("No deployments found or unexpected output format.")
        print(output)
        sys.exit(0)

    # Create ONE single version first (or fall back to the highest existing version if at 200 limit)
    ver_res = subprocess.run('npx @google/clasp version "Update all deployments"', capture_output=True, text=True, shell=True)
    m = re.search(r"version\s+(\d+)", ver_res.stdout + ver_res.stderr, re.IGNORECASE)
    if m:
        version_num = m.group(1)
        print(f"Created new version @{version_num}")
    else:
        versions = re.findall(r"@(\d+)", output)
        version_num = str(max(int(v) for v in versions)) if versions else "1"
        print(f"Reusing latest version @{version_num}")

    print(f"Found {len(dep_ids)} deployments. Updating all to @{version_num}...")
    for did in dep_ids:
        print(f"Updating deployment {did} -> @{version_num}...")
        subprocess.run(f'npx @google/clasp deploy -i {did} -V {version_num} -d "UniPlan HEAD"', shell=True)

    print("All deployments updated successfully!")

if __name__ == "__main__":
    main()
