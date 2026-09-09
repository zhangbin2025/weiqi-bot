import sys

path = sys.argv[1]
with open(path, 'r') as f:
    lines = f.readlines()

content = ''.join(lines)

# ---- Patch 1: Byte order macros for Android ----
# Must be inserted AFTER project() since project() resets CMAKE_CXX_FLAGS.
# Find the first project(katago) call and insert after the enclosing if/endif block.
if 'if(ANDROID)' not in content:
    # Find 'project(katago' line
    proj_idx = None
    for i, line in enumerate(lines):
        if 'project(katago' in line and 'LANGUAGES' in line:
            proj_idx = i
            break
    if proj_idx is None:
        for i, line in enumerate(lines):
            if 'project(katago' in line:
                proj_idx = i
                break
    if proj_idx is None:
        print('  ERROR: Could not find project(katago)')
        sys.exit(1)
    
    # Find the enclosing if/elseif/endif block end
    # Go backwards to find the opening if
    depth = 0
    if_start = None
    for i in range(proj_idx, -1, -1):
        stripped = lines[i].strip()
        if stripped.startswith('endif'):
            depth += 1
        elif stripped.startswith('if(') or stripped.startswith('if ('):
            if depth == 0:
                if_start = i
                break
            depth -= 1
    
    if if_start is None:
        # project() is not inside an if block, insert right after
        insert_at = proj_idx + 1
    else:
        # Find the matching endif for if_start
        depth = 0
        for i in range(if_start, len(lines)):
            stripped = lines[i].strip()
            if stripped.startswith('if(') or stripped.startswith('if ('):
                depth += 1
            elif stripped.startswith('endif'):
                depth -= 1
                if depth == 0:
                    insert_at = i + 1  # after endif
                    break
        else:
            print('  ERROR: Could not find endif for project() block')
            sys.exit(1)
    
    patch_lines = [
        '\n',
        'if(ANDROID)\n',
        '  set(CMAKE_CXX_FLAGS "${CMAKE_CXX_FLAGS} -DBYTE_ORDER=1234 -DLITTLE_ENDIAN=1234 -DBIG_ENDIAN=4321")\n',
        'endif()\n',
    ]
    lines[insert_at:insert_at] = patch_lines
    print(f'  Patch 1: byte order macros applied (after line {insert_at})')

content = ''.join(lines)

# ---- Patch 2: OpenCL dynamic linking for Android ----
if 'dynamic linking libOpenCL.so' not in content:
    opencl_start = None
    for i, line in enumerate(lines):
        if 'elseif(USE_BACKEND STREQUAL "OPENCL")' in line and i+2 < len(lines):
            if 'target_compile_definitions(katago PRIVATE USE_OPENCL_BACKEND)' in lines[i+1] and \
               'find_package(OpenCL)' in lines[i+2]:
                opencl_start = i
                break

    if opencl_start is None:
        print('  ERROR: Could not find OpenCL linking branch')
        sys.exit(1)

    # Find the endif() that closes if(NOT OpenCL_FOUND) by depth counting
    depth = 0
    opencl_endif_idx = None
    for i in range(opencl_start + 3, len(lines)):
        stripped = lines[i].strip()
        if stripped.startswith('if(') or stripped.startswith('if ('):
            depth += 1
        elif stripped.startswith('endif'):
            depth -= 1
            if depth <= 0:
                opencl_endif_idx = i
                break

    if opencl_endif_idx is None:
        print('  ERROR: Could not find end of OpenCL if-block')
        sys.exit(1)

    # Insert if(ANDROID)/else() between target_compile_definitions and find_package
    android_lines = [
        '  if(ANDROID)\n',
        '    # Android: dynamic linking, runtime loads libOpenCL.so\n',
        '    message(STATUS "Android: dynamic linking libOpenCL.so")\n',
        '    include_directories(SYSTEM ${OpenCL_INCLUDE_DIR})\n',
        '    # Link against stub library for symbols; runtime uses clvk libOpenCL.so\n',
        '    target_link_libraries(katago ${OpenCL_LIBRARY})\n',
        '  else()\n',
    ]
    insert_pos = opencl_start + 2
    lines[insert_pos:insert_pos] = android_lines

    # Adjust endif index by number of inserted lines
    opencl_endif_idx += len(android_lines)

    # Insert endif() after the OpenCL branch's endif() to close if(ANDROID)
    lines[opencl_endif_idx + 1:opencl_endif_idx + 1] = ['  endif()\n']

    print('  Patch 2: OpenCL Android dynamic linking applied')

with open(path, 'w') as f:
    f.writelines(lines)
print('  CMakeLists.txt patches applied')
