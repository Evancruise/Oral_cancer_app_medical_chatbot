import fs from 'fs-extra';
import path from 'path';

export async function deletefiles(Folder) {
    await fs.remove(Folder);
};

export const deletefile = async (filePath) => {
  try {
    await fs.promises.unlink(filePath);
    console.log(`🗑️ 已刪除舊檔案: ${filePath}`);
  } catch (err) {
    if (err.code !== 'ENOENT') {
      console.error(`❌ 刪除失敗: ${filePath}`, err);
    }
  }
};

export const movefiles = async (sourceFolder, targetFolder) => {
    fs.readdir(sourceFolder, (err, files) => {
      if (err) {
        return false;
      }

      files.forEach(file => {
        const srcPath = path.join(sourceFolder, file);
        const destPath = path.join(targetFolder, file);

        fs.rename(srcPath, destPath, err => {
          if (err) {console.error(`移動檔案失敗: ${file}`, err);}
        });
      });
    });

    return true;
};

export const getFilesByPattern = async (dir, pattern) => {
  const regex = pattern instanceof RegExp ? pattern : new RegExp(pattern);
  const result = [];

  try {
    const files = await fs.readdir(dir);
    for (const file of files) {
      if (regex.test(file)) {
        result.push(path.join(dir, file));
      }
    }
    return result;
  } catch (err) {
    if (err.code === "ENOENT") {
      console.log(`目錄不存在: ${dir}`);
      return [];
    }
    throw err;
  }
};

export const deleteFilesByPrefix = async (dir, prefix, srcPath) => {
  // try {
    const files = await fs.readdir(dir);

    console.log(`dir: ${dir}, files: ${files}`);

    for (const file of files) {
      console.log(`[deleteFilesByPrefix] file=${file} prefix=${prefix}`);
      if (file.startsWith(prefix) || file.startsWith("00") || file.split("-")[1] === "x") {
        console.log(`file matched with prefix: ${prefix}, so delete it`);
        const filePath = path.join(dir, file);
        await fs.unlink(filePath);
        console.log(`${filePath}`);
      }
    }
  //} catch (err) {
  //  console.error("刪除檔案失敗:", err);
  //}
};