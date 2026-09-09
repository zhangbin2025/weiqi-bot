import sys

path = sys.argv[1]
with open(path, 'r') as f:
    content = f.read()

old = 'bool shouldTestFP16TensorCores = testFP16TensorCoresMode == enabled_t::True || (testFP16TensorCoresMode == enabled_t::Auto && !foundGoodFP16);'
new = '''bool shouldTestFP16TensorCores = testFP16TensorCoresMode == enabled_t::True || (testFP16TensorCoresMode == enabled_t::Auto && !foundGoodFP16);
      // WMMA kernels use ARM Mali built-in instructions that crash non-Mali OpenCL implementations
      // (e.g. clvk). Skip tuning if the device does not advertise cl_arm_matrix_ops extension.
      bool deviceSupportsArmWmma = false;
      for(const InitializedDevice* dev : devicesContext.devicesToUse) {
        if(dev->info.extensions.find("cl_arm_matrix_ops") != string::npos) {
          deviceSupportsArmWmma = true;
          break;
        }
      }
      if(!deviceSupportsArmWmma) {
        shouldTestFP16TensorCores = false;
        out << "Skipping FP16 tensor core (WMMA) tuning: device does not support cl_arm_matrix_ops" << endl;
      }'''

if old not in content:
    print('ERROR: Could not find target string')
    sys.exit(1)

content = content.replace(old, new, 1)
with open(path, 'w') as f:
    f.write(content)
print('WMMA skip patch applied')
