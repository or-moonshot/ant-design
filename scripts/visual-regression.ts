/* eslint-disable no-console, no-await-in-loop, import/no-extraneous-dependencies, lodash/import-scope, no-restricted-syntax */
import path from 'path';
import fs from 'fs';

import fse from 'fs-extra';
import chalk from 'chalk';
import _ from 'lodash';
import pixelmatch from 'pixelmatch';
import { PNG } from 'pngjs';
import sharp from 'sharp';

const compareScreenshots = async (
  baseImgPath: string,
  currentImgPath: string,
  diffImagePath: string,
): Promise<number> => {
  const baseImgBuf = await sharp(baseImgPath).toBuffer();
  const currentImgBuf = await sharp(currentImgPath).toBuffer();

  const basePng = PNG.sync.read(baseImgBuf);
  const targetWidth = basePng.width;
  const targetHeight = basePng.height;

  const comparePng = PNG.sync.read(
    await sharp(currentImgBuf)
      .resize({
        width: targetWidth,
        height: targetHeight,
        fit: sharp.fit.contain,
        background: { r: 255, g: 255, b: 255, alpha: 0 },
      })
      .png()
      .toBuffer(),
  );

  const diffPng = new PNG({ width: targetWidth, height: targetHeight });

  const mismatchedPixels = pixelmatch(
    basePng.data,
    comparePng.data,
    diffPng.data,
    targetWidth,
    targetHeight,
    { threshold: 0.1, diffMask: false },
  );

  // if mismatched then write diff image
  if (mismatchedPixels) {
    diffPng.sync.write(diffImagePath);
  }

  return (mismatchedPixels / (targetWidth * targetHeight)) * 100;
};

const readPngs = (dir: string) => fs.readdirSync(dir).filter((n) => n.endsWith('.png'));

const prettyList = (list: string[]) => list.map((i) => ` * ${i}`).join('\n');

async function boot() {
  const baseImgDir = path.resolve(__dirname, '../imageSnapshots-master');
  const currentImgDir = path.resolve(__dirname, '../imageSnapshots');
  const diffImgDir = path.resolve(__dirname, '../imageDiffSnapshots');

  console.log(chalk.blue('⛳ Checking image snapshots with branch `master`'));
  console.log('\n');

  // TODO: 需要强校验 master 分支的截图是否存在，可能原因是没有下载成功
  const baseImgFileList = readPngs(baseImgDir);
  const currentImgFileList = readPngs(currentImgDir);

  const deletedImgs = _.difference(baseImgFileList, currentImgFileList);
  if (deletedImgs.length) {
    console.log(chalk.red('⛔️ Missing images compare to master:\n'), prettyList(deletedImgs));
    console.log('\n');
  }
  // ignore new images
  const newImgs = _.difference(currentImgFileList, baseImgFileList);
  if (newImgs.length) {
    console.log(chalk.green('🆕 Added images:\n'), prettyList(newImgs));
    console.log('\n');
  }

  await fse.ensureDir(diffImgDir);

  let reportMdStr = `
| image_name | expected | actual | diff |
| --- | --- | --- | --- |
  `.trim();

  let badCaseCounts = 0;

  for (const file of baseImgFileList) {
    const baseImgPath = path.join(baseImgDir, file);
    const currentImgPath = path.join(currentImgDir, file);
    const diffImgPath = path.join(diffImgDir, file);

    // eslint-disable-next-line
    const currentImgExists = await fse.exists(currentImgPath);
    if (!currentImgExists) {
      console.log(chalk.red(`⛔️ Missing image: ${file}\n`));
      continue;
    }

    const mismatchedPxPercent = await compareScreenshots(baseImgPath, currentImgPath, diffImgPath);

    if (mismatchedPxPercent > 0) {
      console.log(
        'Mismatched pixels for:',
        chalk.yellow(file),
        `${mismatchedPxPercent.toFixed(2)}%\n`,
      );
      badCaseCounts++;

      const baseImgBase64 = await fs.promises.readFile(baseImgPath, 'base64');
      const currentImgBase64 = await fs.promises.readFile(currentImgPath, 'base64');
      const diffImgBase64 = await fs.promises.readFile(diffImgPath, 'base64');

      reportMdStr += `\n| ${[
        path.basename(file),
        `![master ref](data:image/png;base64,${baseImgBase64})`,
        `![pr commit-id](data:image/png;base64,${currentImgBase64})`,
        `![diff](data:image/png;base64,${diffImgBase64})`,
      ].join(' | ')} |`;
    } else {
      console.log('Passed for: %s\n', chalk.green(file));
    }
  }

  if (badCaseCounts) {
    await fs.promises.writeFile(
      path.resolve(__dirname, '../visual-regression-report.md'),
      reportMdStr,
      'utf8',
    );
  } else {
    await fs.promises.writeFile(
      path.resolve(__dirname, '../visual-regression-report.md'),
      `No visual diff differences have been found`.trim(),
      'utf8',
    );
  }
}

boot();
