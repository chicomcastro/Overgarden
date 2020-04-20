using System.Collections;
using System.Collections.Generic;
using UnityEngine;

[CreateAssetMenu(fileName = "New Plant", menuName = "Plant")]
public class PlantScriptableObject : ScriptableObject
{   
    public string plantName;
    public int plantRarity;
    public string plantDescription; //caso vcs queiram colocar descrições pra cada planta

    public Sprite main;
    public Sprite[] stageSprite = new Sprite[4];
}
